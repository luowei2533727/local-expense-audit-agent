import { Response } from 'express';
import bcrypt from 'bcryptjs';
import type { Role } from '../domain/constants';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const createUserSchema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少需要 8 个字符'),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).default('EMPLOYEE'),
  manager_id: z.string().optional(),
  is_manager_approver: z.boolean().default(false),
});

export const listUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { company_id: req.user!.company_id },
      select: {
        id: true,
        email: true,
        role: true,
        manager_id: true,
        is_manager_approver: true,
        created_at: true,
        manager: { select: { id: true, email: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ success: false, error: '获取用户列表失败' });
  }
};

export const createUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { email, password, role, manager_id, is_manager_approver } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: '该邮箱已被使用' });
      return;
    }

    if (manager_id) {
      const manager = await prisma.user.findFirst({
        where: { id: manager_id, company_id: req.user!.company_id },
      });
      if (!manager) {
        res.status(400).json({ success: false, error: '在当前企业中找不到该经理' });
        return;
      }
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        role: role as Role,
        company_id: req.user!.company_id,
        manager_id: manager_id || null,
        is_manager_approver,
      },
      select: {
        id: true,
        email: true,
        role: true,
        manager_id: true,
        is_manager_approver: true,
        created_at: true,
      },
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ success: false, error: '创建用户失败' });
  }
};

export const updateUserRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['ADMIN', 'MANAGER', 'EMPLOYEE'].includes(role)) {
      res.status(400).json({ success: false, error: '用户角色无效' });
      return;
    }

    const target = await prisma.user.findFirst({
      where: { id, company_id: req.user!.company_id },
    });
    if (!target) {
      res.status(404).json({ success: false, error: '找不到该用户' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: role as Role },
      select: { id: true, email: true, role: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ success: false, error: '更新用户角色失败' });
  }
};

export const assignManager = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { manager_id, is_manager_approver } = req.body;

    const target = await prisma.user.findFirst({
      where: { id, company_id: req.user!.company_id },
    });
    if (!target) {
      res.status(404).json({ success: false, error: '找不到该用户' });
      return;
    }

    if (manager_id) {
      const manager = await prisma.user.findFirst({
        where: { id: manager_id, company_id: req.user!.company_id },
      });
      if (!manager) {
        res.status(400).json({ success: false, error: '在当前企业中找不到该经理' });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        manager_id: manager_id || null,
        is_manager_approver: is_manager_approver ?? target.is_manager_approver,
      },
      select: { id: true, email: true, role: true, manager_id: true, is_manager_approver: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Assign manager error:', err);
    res.status(500).json({ success: false, error: '分配直属经理失败' });
  }
};
