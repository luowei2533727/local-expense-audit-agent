import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import {
  ClaimSnapshot,
  evaluateClaimRules,
  getConfiguredModels,
  getDefaultModel,
  getOllamaMemory,
  listOllamaModels,
  reconcileAssessmentWithPolicy,
  runClaimAgent,
  unloadOllamaModel,
} from '../services/pi-agent.service';

const compareSchema = z.object({
  models: z.array(z.string().min(1)).length(3).optional(),
}).default({});

async function getAuthorizedExpense(expenseId: string, companyId: string) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { employee: { select: { company_id: true, email: true } } },
  });
  if (!expense || expense.employee.company_id !== companyId) return null;
  return expense;
}

function toSnapshot(expense: NonNullable<Awaited<ReturnType<typeof getAuthorizedExpense>>>): ClaimSnapshot {
  return {
    id: expense.id,
    amount: expense.amount,
    currency: expense.currency,
    convertedAmount: expense.converted_amount,
    baseCurrency: expense.base_currency,
    category: expense.category,
    description: expense.description,
    expenseDate: expense.expense_date.toISOString(),
    merchantName: expense.merchant_name,
    receiptPresent: Boolean(expense.receipt_url),
    submittedAt: expense.created_at.toISOString(),
  };
}

async function persistSuccessfulRun(
  expenseId: string,
  model: string,
  run: Awaited<ReturnType<typeof runClaimAgent>>,
  trustedEvaluation: ReturnType<typeof evaluateClaimRules>,
): Promise<Record<string, unknown>> {
  const memory = await getOllamaMemory(model);
  const reconciled = reconcileAssessmentWithPolicy(run.assessment, trustedEvaluation);
  const guardrailApplied = run.guardrailApplied || reconciled.applied;
  const metrics = {
    ...run.metrics,
    ...memory,
    policyGuardrailApplied: reconciled.applied,
    policyMismatches: reconciled.mismatches,
  };
  const trace = reconciled.applied
    ? [...run.trace, {
        sequence: run.trace.length + 1,
        eventType: 'policy_guardrail_applied',
        detail: { mismatches: reconciled.mismatches },
      }]
    : run.trace;
  await prisma.$transaction([
    prisma.agentAssessment.create({
      data: {
        expense_id: expenseId,
        model,
        recommendation: reconciled.assessment.recommendation,
        risk_level: reconciled.assessment.risk_level,
        summary: reconciled.assessment.summary,
        checks_json: JSON.stringify(reconciled.assessment.checks),
        missing_documents: JSON.stringify(reconciled.assessment.missing_documents),
        confidence: reconciled.assessment.confidence,
        human_review_required: true,
        guardrail_applied: guardrailApplied,
        trace_id: run.traceId,
        metrics_json: JSON.stringify(metrics),
      },
    }),
    ...trace.map((event) => prisma.agentTrace.create({
      data: { trace_id: run.traceId, sequence: event.sequence, event_type: event.eventType, detail_json: JSON.stringify(event.detail) },
    })),
  ]);
  return {
    success: true,
    model,
    ...reconciled.assessment,
    guardrailApplied,
    policyGuardrailApplied: reconciled.applied,
    policyMismatches: reconciled.mismatches,
    metrics,
    traceId: run.traceId,
  };
}

export const modelStatus = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const configured = getConfiguredModels();
  try {
    const installed = await listOllamaModels();
    const names = new Set(installed.map((item) => item.name));
    res.json({
      success: true,
      data: {
        online: true,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        defaultModel: getDefaultModel(),
        configured: configured.map((name) => ({ name, installed: names.has(name), sizeBytes: installed.find((item) => item.name === name)?.size || null })),
      },
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: error instanceof Error ? error.message : 'Ollama 当前不可用',
      data: { online: false, configured: configured.map((name) => ({ name, installed: false, sizeBytes: null })) },
    });
  }
};

export const assessExpense = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const expense = await getAuthorizedExpense(req.params.expenseId, req.user!.company_id);
  if (!expense) {
    res.status(404).json({ success: false, error: '找不到该报销单' });
    return;
  }
  const model = getDefaultModel();
  const snapshot = toSnapshot(expense);
  const now = new Date();
  try {
    const trustedEvaluation = evaluateClaimRules(snapshot, undefined, now);
    const run = await runClaimAgent(snapshot, model, { now });
    const result = await persistSuccessfulRun(expense.id, model, run, trustedEvaluation);
    res.json({ success: true, data: { ...result, humanReviewRequired: true } });
  } finally {
    await unloadOllamaModel(model);
  }
};

export const compareModels = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = compareSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ success: false, error: '模型列表必须恰好包含三个模型名称' });
    return;
  }
  const configured = getConfiguredModels();
  const models = parsed.data.models || configured;
  if (models.length !== 3 || new Set(models).size !== 3 || models.some((model) => !configured.includes(model))) {
    res.status(400).json({ success: false, error: '请从 OLLAMA_COMPARE_MODELS 中选择三个不重复的模型' });
    return;
  }

  const expense = await getAuthorizedExpense(req.params.expenseId, req.user!.company_id);
  if (!expense) {
    res.status(404).json({ success: false, error: '找不到该报销单' });
    return;
  }

  const snapshot = toSnapshot(expense);
  const results: Array<Record<string, unknown>> = [];
  for (const model of models) {
    const now = new Date();
    try {
      const trustedEvaluation = evaluateClaimRules(snapshot, undefined, now);
      const run = await runClaimAgent(snapshot, model, { now });
      results.push(await persistSuccessfulRun(expense.id, model, run, trustedEvaluation));
    } catch (error) {
      results.push({ success: false, model, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await unloadOllamaModel(model);
    }
  }

  res.json({
    success: true,
    data: {
      expense: { id: expense.id, merchantName: expense.merchant_name, amount: expense.amount, currency: expense.currency },
      comparedAt: new Date().toISOString(),
      fairRun: '顺序运行 / 同一报销单 / 同一规则 / 温度 0',
      humanReviewRequired: true,
      results,
    },
  });
};

export const listAssessments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const expense = await getAuthorizedExpense(req.params.expenseId, req.user!.company_id);
  if (!expense) {
    res.status(404).json({ success: false, error: '找不到该报销单' });
    return;
  }
  const assessments = await prisma.agentAssessment.findMany({
    where: { expense_id: expense.id }, orderBy: { created_at: 'desc' }, take: 30,
  });
  res.json({
    success: true,
    data: assessments.map((item) => ({
      ...item,
      checks_json: JSON.parse(item.checks_json),
      missing_documents: JSON.parse(item.missing_documents),
      metrics_json: JSON.parse(item.metrics_json),
    })),
  });
};
