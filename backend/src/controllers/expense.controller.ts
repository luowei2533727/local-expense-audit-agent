import { Response } from 'express';
import { ExpenseStatus } from '../domain/constants';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { initiateApprovalWorkflow, processApproval } from '../services/approval.service';
import { convertAmount } from '../services/currency.service';
import { extractReceiptData } from '../services/ocr.service';
import { createReceiptAsset, readReceiptAsset, validateReceiptImage } from '../services/receipt-storage.service';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const submitExpenseSchema = z.object({
  amount: z.number().positive('报销金额必须大于零'),
  currency: z.string().length(3, '币种必须使用三位代码'),
  category: z.string().min(1, '请选择报销类别'),
  description: z.string().min(1, '请填写报销说明'),
  expense_date: z.string(),
  merchant_name: z.string().optional(),
  receipt_asset_id: z.string().min(1).optional(),
});

async function createAuditLog(
  expenseId: string,
  actorId: string,
  action: string,
  metadata: Record<string, unknown>,
  ipAddress?: string
) {
  await prisma.auditLog.create({
    data: {
      expense_id: expenseId,
      actor_id: actorId,
      action,
      metadata: JSON.stringify(metadata),
      ip_address: ipAddress || null,
    },
  });
}

export const submitExpense = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = submitExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { amount, currency, category, description, expense_date, merchant_name, receipt_asset_id } = parsed.data;

    const employee = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { company: true },
    });
    if (!employee) {
      res.status(404).json({ success: false, error: '找不到该员工' });
      return;
    }

    const baseCurrency = employee.company.currency_code;
    let converted_amount: number | null = null;
    try {
      converted_amount = await convertAmount(amount, currency, baseCurrency);
    } catch {
      converted_amount = null;
    }

    const receiptAsset = receipt_asset_id
      ? await prisma.receiptAsset.findFirst({ where: { id: receipt_asset_id, owner_id: req.user!.id, expense_id: null } })
      : null;
    if (receipt_asset_id && !receiptAsset) {
      res.status(400).json({ success: false, error: '票据附件无效、已被使用或不属于当前用户' });
      return;
    }

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          employee_id: req.user!.id,
          amount,
          currency,
          converted_amount,
          base_currency: baseCurrency,
          category,
          description,
          expense_date: new Date(expense_date),
          merchant_name: merchant_name || null,
          receipt_url: null,
          status: ExpenseStatus.PENDING,
        },
      });
      if (!receiptAsset) return created;
      const bound = await tx.receiptAsset.updateMany({
        where: { id: receiptAsset.id, owner_id: req.user!.id, expense_id: null },
        data: { expense_id: created.id },
      });
      if (bound.count !== 1) throw new Error('票据附件已被其他报销单使用');
      return tx.expense.update({
        where: { id: created.id },
        data: { receipt_url: `/api/expenses/${created.id}/receipt` },
      });
    });

    await createAuditLog(
      expense.id,
      req.user!.id,
      'SUBMITTED',
      { amount, currency, category, merchant_name },
      req.ip
    );

    await initiateApprovalWorkflow(expense.id, req.user!.id, req.user!.company_id);

    const updated = await prisma.expense.findUnique({ where: { id: expense.id } });
    res.status(201).json({ success: true, data: updated });
  } catch (err) {
    console.error('Submit expense error:', err);
    res.status(500).json({ success: false, error: '提交报销失败' });
  }
};

export const getMyExpenses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { employee_id: req.user!.id },
      orderBy: { created_at: 'desc' },
      include: {
        approval_requests: {
          include: { approver: { select: { id: true, email: true } } },
          orderBy: { created_at: 'desc' },
        },
      },
    });
    res.json({ success: true, data: expenses });
  } catch (err) {
    console.error('Get my expenses error:', err);
    res.status(500).json({ success: false, error: '获取报销记录失败' });
  }
};

export const getPendingExpenses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Manager sees expenses where they have a pending approval request
    const pendingRequests = await prisma.approvalRequest.findMany({
      where: {
        approver_id: req.user!.id,
        status: 'PENDING',
      },
      include: {
        expense: {
          include: {
            employee: { select: { id: true, email: true, role: true } },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    const expenses = pendingRequests.map((r) => ({
      ...r.expense,
      approval_request_id: r.id,
    }));

    res.json({ success: true, data: expenses });
  } catch (err) {
    console.error('Get pending expenses error:', err);
    res.status(500).json({ success: false, error: '获取待审批报销失败' });
  }
};

export const getAllExpenses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, employee_id, category, start_date, end_date, min_amount, max_amount } = req.query;

    const where: Record<string, unknown> = {
      employee: { company_id: req.user!.company_id },
    };

    if (status) where.status = status;
    if (employee_id) where.employee_id = employee_id;
    if (category) where.category = category;

    if (start_date || end_date) {
      where.expense_date = {};
      if (start_date) (where.expense_date as Record<string, unknown>).gte = new Date(start_date as string);
      if (end_date) (where.expense_date as Record<string, unknown>).lte = new Date(end_date as string);
    }

    if (min_amount || max_amount) {
      where.amount = {};
      if (min_amount) (where.amount as Record<string, unknown>).gte = parseFloat(min_amount as string);
      if (max_amount) (where.amount as Record<string, unknown>).lte = parseFloat(max_amount as string);
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        employee: { select: { id: true, email: true, role: true } },
        approval_requests: {
          include: { approver: { select: { id: true, email: true } } },
          orderBy: { created_at: 'desc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({ success: true, data: expenses });
  } catch (err) {
    console.error('Get all expenses error:', err);
    res.status(500).json({ success: false, error: '获取报销记录失败' });
  }
};

export const approveExpense = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      res.status(404).json({ success: false, error: '找不到该报销单' });
      return;
    }

    await processApproval(id, req.user!.id, true, comment);

    await createAuditLog(
      id,
      req.user!.id,
      'APPROVED',
      { comment: comment || '' },
      req.ip
    );

    const updated = await prisma.expense.findUnique({ where: { id } });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Approve expense error:', err);
    res.status(500).json({ success: false, error: '通过报销失败' });
  }
};

export const rejectExpense = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length < 5) {
      res.status(400).json({ success: false, error: '驳回原因至少需要 5 个字符' });
      return;
    }

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      res.status(404).json({ success: false, error: '找不到该报销单' });
      return;
    }

    await processApproval(id, req.user!.id, false, comment);

    await createAuditLog(
      id,
      req.user!.id,
      'REJECTED',
      { comment },
      req.ip
    );

    const updated = await prisma.expense.findUnique({ where: { id } });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Reject expense error:', err);
    res.status(500).json({ success: false, error: '驳回报销失败' });
  }
};

export const ocrReceipt = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { image_base64, mime_type } = req.body;

    if (!image_base64 || !mime_type) {
      res.status(400).json({ success: false, error: '缺少票据图片或图片格式' });
      return;
    }

    validateReceiptImage(image_base64, mime_type);
    const result = await extractReceiptData(image_base64, mime_type);
    const receiptAssetId = await createReceiptAsset(req.user!.id, image_base64, mime_type);
    res.json({ success: true, data: { ...result, receipt_asset_id: receiptAssetId } });
  } catch (err) {
    console.error('OCR error:', err);
    const message = err instanceof Error ? err.message : '票据识别失败';
    const isInputError = /不支持|Base64|小于 10MB|格式不一致/.test(message);
    res.status(isInputError ? 400 : 500).json({ success: false, error: message });
  }
};

export const getExpenseReceipt = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { company_id: true } } },
    });
    if (!expense) {
      res.status(404).json({ success: false, error: '找不到该报销单' });
      return;
    }
    const ownsExpense = expense.employee_id === req.user!.id;
    const canReviewCompanyExpense = ['MANAGER', 'ADMIN'].includes(req.user!.role)
      && expense.employee.company_id === req.user!.company_id;
    if (!ownsExpense && !canReviewCompanyExpense) {
      res.status(403).json({ success: false, error: '无权访问该票据' });
      return;
    }
    const asset = await readReceiptAsset(expense.id);
    if (!asset) {
      res.status(404).json({ success: false, error: '找不到票据附件' });
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(asset.bytes);
  } catch (err) {
    console.error('Get receipt error:', err);
    res.status(500).json({ success: false, error: '读取票据失败' });
  }
};

export const getExpenseAudit = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      res.status(404).json({ success: false, error: '找不到该报销单' });
      return;
    }

    // Admin can only see expenses in their company
    const employee = await prisma.user.findUnique({ where: { id: expense.employee_id } });
    if (!employee || employee.company_id !== req.user!.company_id) {
      res.status(403).json({ success: false, error: '无权访问该报销单' });
      return;
    }

    const audit = await prisma.auditLog.findMany({
      where: { expense_id: id },
      include: {
        actor: { select: { id: true, email: true, role: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    res.json({
      success: true,
      data: audit.map((item) => ({
        ...item,
        metadata: JSON.parse(item.metadata) as Record<string, unknown>,
      })),
    });
  } catch (err) {
    console.error('Get audit error:', err);
    res.status(500).json({ success: false, error: '获取审计记录失败' });
  }
};
