import 'dotenv/config';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ClaimAssessment,
  ClaimPolicy,
  ClaimSnapshot,
  evaluateClaimRules,
  getConfiguredModels,
  getOllamaMemory,
  runClaimAgent,
  unloadOllamaModel,
} from '../src/services/pi-agent.service';

const RUN_ID = process.argv.find((arg) => arg.startsWith('--run-id='))?.split('=')[1]
  || new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = resolve(process.cwd(), 'benchmarks');
const OUTPUT_JSON = resolve(OUTPUT_DIR, `benchmark-50-${RUN_ID}.json`);
const OUTPUT_CSV = resolve(OUTPUT_DIR, `benchmark-50-${RUN_ID}.csv`);
const OUTPUT_MD = resolve(OUTPUT_DIR, `benchmark-50-${RUN_ID}.md`);

const BENCHMARK_NOW = new Date('2026-08-26T06:00:00.000Z');
const POLICY: ClaimPolicy = {
  maxAgeDays: 90,
  receiptRequiredAbove: 0,
  highAmountThreshold: 1000,
};

type Scenario =
  | '正常合规'
  | '缺少票据'
  | '高额报销'
  | '超过期限'
  | '未来日期'
  | '非法币种'
  | '非法类别'
  | '缺少商户'
  | '说明过短'
  | '多重风险';

interface BenchmarkCase {
  id: string;
  scenario: Scenario;
  claim: ClaimSnapshot;
  expected: ReturnType<typeof evaluateClaimRules>;
}

interface BenchmarkRecord {
  caseId: string;
  scenario: Scenario;
  model: string;
  success: boolean;
  error?: string;
  expected: {
    recommendation: ClaimAssessment['recommendation'];
    riskLevel: ClaimAssessment['risk_level'];
    missingDocuments: string[];
    checks: ClaimAssessment['checks'];
  };
  actual?: ClaimAssessment;
  metrics?: Awaited<ReturnType<typeof runClaimAgent>>['metrics'] & {
    sizeBytes: number | null;
    vramBytes: number | null;
  };
  traceId?: string;
  guardrailApplied?: boolean;
  recommendationMatch: boolean;
  riskMatch: boolean;
  missingDocumentsMatch: boolean;
  exactDecisionMatch: boolean;
  checkCoverage: number;
  checkStatusAccuracy: number;
  finishedAt: string;
}

interface BenchmarkState {
  runId: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  benchmarkNow: string;
  environment: {
    execution: string;
    temperature: number;
    keepAlive: string;
    models: string[];
    totalCases: number;
    totalEvaluations: number;
  };
  policy: ClaimPolicy;
  cases: BenchmarkCase[];
  records: BenchmarkRecord[];
  summaries?: ModelSummary[];
}

interface ModelSummary {
  model: string;
  evaluations: number;
  successes: number;
  structuredSuccessRate: number;
  recommendationAccuracy: number;
  riskAccuracy: number;
  missingDocumentsAccuracy: number;
  exactDecisionAccuracy: number;
  averageCheckCoverage: number;
  averageCheckStatusAccuracy: number;
  repairRate: number;
  averageRepairAttempts: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageFirstTokenMs: number;
  averageTokensPerSecond: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  modelSizeBytes: number | null;
}

function daysFromNow(days: number): string {
  return new Date(BENCHMARK_NOW.getTime() + days * 86_400_000).toISOString();
}

function buildCases(): BenchmarkCase[] {
  const scenarios: Scenario[] = [
    '正常合规', '缺少票据', '高额报销', '超过期限', '未来日期',
    '非法币种', '非法类别', '缺少商户', '说明过短', '多重风险',
  ];
  const categories = ['Travel', 'Meals', 'Accommodation', 'Office Supplies', 'Software'];
  const cases: BenchmarkCase[] = [];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    for (let variant = 0; variant < 5; variant += 1) {
      const number = scenarioIndex * 5 + variant + 1;
      const claim: ClaimSnapshot = {
        id: `benchmark-${String(number).padStart(3, '0')}`,
        amount: 280 + variant * 37,
        currency: 'CNY',
        convertedAmount: null,
        baseCurrency: 'CNY',
        category: categories[variant],
        description: `第 ${variant + 1} 组客户项目的正常业务报销支出`,
        expenseDate: daysFromNow(-(5 + variant * 3)),
        merchantName: `测试商户 ${variant + 1} 号`,
        receiptPresent: true,
        submittedAt: daysFromNow(0),
      };

      switch (scenario) {
        case '缺少票据':
          claim.receiptPresent = false;
          break;
        case '高额报销':
          claim.amount = 1500 + variant * 850;
          break;
        case '超过期限':
          claim.expenseDate = daysFromNow(-(95 + variant * 20));
          break;
        case '未来日期':
          claim.expenseDate = daysFromNow(3 + variant * 2);
          break;
        case '非法币种':
          claim.currency = variant % 2 === 0 ? 'CN' : '人民币';
          break;
        case '非法类别':
          claim.category = variant % 2 === 0 ? 'Personal' : 'Unknown';
          break;
        case '缺少商户':
          claim.merchantName = null;
          break;
        case '说明过短':
          claim.description = variant % 2 === 0 ? '午餐' : '差旅费';
          break;
        case '多重风险':
          claim.amount = 5000 + variant * 1000;
          claim.currency = 'XX';
          claim.category = 'Personal';
          claim.description = '个人使用';
          claim.expenseDate = daysFromNow(5 + variant);
          claim.merchantName = null;
          claim.receiptPresent = false;
          break;
        case '正常合规':
          break;
      }

      cases.push({
        id: claim.id,
        scenario,
        claim,
        expected: evaluateClaimRules(claim, POLICY, BENCHMARK_NOW),
      });
    }
  }
  return cases;
}

function sameStrings(left: string[], right: string[]): boolean {
  return [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
}

function compareChecks(expected: ClaimAssessment['checks'], actual: ClaimAssessment['checks']): {
  coverage: number;
  statusAccuracy: number;
} {
  const actualByName = new Map(actual.map((check) => [check.name, check]));
  const covered = expected.filter((check) => actualByName.has(check.name)).length;
  const correct = expected.filter((check) => actualByName.get(check.name)?.status === check.status).length;
  return {
    coverage: expected.length ? covered / expected.length : 1,
    statusAccuracy: expected.length ? correct / expected.length : 1,
  };
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

function summarize(records: BenchmarkRecord[], models: string[]): ModelSummary[] {
  return models.map((model) => {
    const rows = records.filter((record) => record.model === model);
    const successes = rows.filter((record) => record.success && record.actual && record.metrics);
    const latencies = successes.flatMap((record) => record.metrics ? [record.metrics.latencyMs] : []);
    const firstTokens = successes.flatMap((record) => record.metrics?.firstTokenMs != null ? [record.metrics.firstTokenMs] : []);
    const tokenRates = successes.flatMap((record) => record.metrics ? [record.metrics.tokensPerSecond] : []);
    const repairs = successes.flatMap((record) => record.metrics ? [record.metrics.repairAttempts] : []);
    const rate = (predicate: (record: BenchmarkRecord) => boolean) => rows.length
      ? rows.filter(predicate).length / rows.length
      : 0;

    return {
      model,
      evaluations: rows.length,
      successes: successes.length,
      structuredSuccessRate: round(successes.length / Math.max(rows.length, 1)),
      recommendationAccuracy: round(rate((record) => record.recommendationMatch)),
      riskAccuracy: round(rate((record) => record.riskMatch)),
      missingDocumentsAccuracy: round(rate((record) => record.missingDocumentsMatch)),
      exactDecisionAccuracy: round(rate((record) => record.exactDecisionMatch)),
      averageCheckCoverage: round(average(rows.map((record) => record.checkCoverage))),
      averageCheckStatusAccuracy: round(average(rows.map((record) => record.checkStatusAccuracy))),
      repairRate: round(successes.filter((record) => (record.metrics?.repairAttempts || 0) > 0).length / Math.max(successes.length, 1)),
      averageRepairAttempts: round(average(repairs)),
      averageLatencyMs: Math.round(average(latencies)),
      p50LatencyMs: Math.round(percentile(latencies, 0.5)),
      p95LatencyMs: Math.round(percentile(latencies, 0.95)),
      averageFirstTokenMs: Math.round(average(firstTokens)),
      averageTokensPerSecond: round(average(tokenRates), 2),
      totalInputTokens: successes.reduce((sum, record) => sum + (record.metrics?.inputTokens || 0), 0),
      totalOutputTokens: successes.reduce((sum, record) => sum + (record.metrics?.outputTokens || 0), 0),
      modelSizeBytes: successes.find((record) => record.metrics?.sizeBytes)?.metrics?.sizeBytes || null,
    };
  });
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function writeArtifacts(state: BenchmarkState, complete = false): void {
  state.updatedAt = new Date().toISOString();
  state.summaries = summarize(state.records, state.environment.models);
  if (complete) state.finishedAt = new Date().toISOString();
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const headers = [
    'caseId', 'scenario', 'model', 'success', 'expectedRecommendation', 'actualRecommendation',
    'expectedRisk', 'actualRisk', 'recommendationMatch', 'riskMatch', 'missingDocumentsMatch',
    'exactDecisionMatch', 'checkCoverage', 'checkStatusAccuracy', 'latencyMs', 'firstTokenMs',
    'tokensPerSecond', 'inputTokens', 'outputTokens', 'agentTurns', 'toolCalls', 'repairAttempts',
    'confidence', 'error',
  ];
  const csvRows = state.records.map((record) => [
    record.caseId, record.scenario, record.model, record.success,
    record.expected.recommendation, record.actual?.recommendation,
    record.expected.riskLevel, record.actual?.risk_level,
    record.recommendationMatch, record.riskMatch, record.missingDocumentsMatch,
    record.exactDecisionMatch, round(record.checkCoverage), round(record.checkStatusAccuracy),
    record.metrics?.latencyMs, record.metrics?.firstTokenMs, record.metrics?.tokensPerSecond,
    record.metrics?.inputTokens, record.metrics?.outputTokens, record.metrics?.agentTurns,
    record.metrics?.toolCalls, record.metrics?.repairAttempts, record.actual?.confidence, record.error,
  ].map(csvEscape).join(','));
  writeFileSync(OUTPUT_CSV, `${headers.map(csvEscape).join(',')}\n${csvRows.join('\n')}\n`, 'utf8');

  if (complete) {
    const scenarioCounts = Object.entries(state.cases.reduce<Record<string, number>>((counts, item) => {
      counts[item.scenario] = (counts[item.scenario] || 0) + 1;
      return counts;
    }, {})).map(([scenario, count]) => `- ${scenario}：${count} 条`).join('\n');
    const summaries = state.summaries || [];
    const tableRows = summaries.map((summary) =>
      `| ${summary.model} | ${summary.successes}/${summary.evaluations} | ${(summary.recommendationAccuracy * 100).toFixed(1)}% | ${(summary.riskAccuracy * 100).toFixed(1)}% | ${(summary.missingDocumentsAccuracy * 100).toFixed(1)}% | ${(summary.exactDecisionAccuracy * 100).toFixed(1)}% | ${(summary.averageCheckCoverage * 100).toFixed(1)}% | ${(summary.averageCheckStatusAccuracy * 100).toFixed(1)}% | ${(summary.averageFirstTokenMs / 1000).toFixed(2)}s | ${(summary.averageLatencyMs / 1000).toFixed(2)}s | ${(summary.p95LatencyMs / 1000).toFixed(2)}s | ${summary.averageTokensPerSecond.toFixed(2)} | ${(summary.repairRate * 100).toFixed(1)}% |`,
    ).join('\n');
    const bestDecision = [...summaries].sort((a, b) => b.exactDecisionAccuracy - a.exactDecisionAccuracy)[0];
    const fastest = [...summaries].sort((a, b) => a.averageLatencyMs - b.averageLatencyMs)[0];
    const fastestFirstToken = [...summaries].sort((a, b) => a.averageFirstTokenMs - b.averageFirstTokenMs)[0];
    const failures = state.records.filter((record) => !record.success);
    const elapsedMinutes = state.finishedAt
      ? (new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime()) / 60_000
      : 0;
    const markdown = `# ExpensePilot 50 条三模型评测报告\n\n`
      + `- 运行编号：${state.runId}\n- 开始时间：${state.startedAt}\n- 完成时间：${state.finishedAt}\n`
      + `- 总样本：50 条\n- 总评测：150 次\n- 执行方式：${state.environment.execution}\n`
      + `- 总运行时间：${elapsedMinutes.toFixed(1)} 分钟\n`
      + `- 统一条件：temperature=0，PI Agent + evaluate_claim，固定规则，强制人工审核\n\n`
      + `## 数据集分布\n\n${scenarioCounts}\n\n`
      + `## 模型结果\n\n`
      + `| 模型 | 结构化成功 | 建议准确率 | 风险准确率 | 缺失材料准确率 | 完整决策准确率 | 检查覆盖率 | 检查状态准确率 | 平均TTFT | 平均耗时 | P95耗时 | Token/s | 修复率 |\n`
      + `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${tableRows}\n\n`
      + `## 结果摘要\n\n`
      + `- 完整决策准确率最高：${bestDecision?.model || '—'}（${((bestDecision?.exactDecisionAccuracy || 0) * 100).toFixed(1)}%）\n`
      + `- 平均总耗时最低：${fastest?.model || '—'}（${((fastest?.averageLatencyMs || 0) / 1000).toFixed(2)} 秒）\n`
      + `- 平均首 Token 最快：${fastestFirstToken?.model || '—'}（${((fastestFirstToken?.averageFirstTokenMs || 0) / 1000).toFixed(2)} 秒）\n`
      + `- 运行级失败：${failures.length} 次${failures.length ? `（${failures.map((item) => `${item.model}/${item.caseId}: ${item.error}`).join('；')}）` : ''}\n\n`
      + `> 准确率以服务端确定性规则 evaluate_claim 的输出作为受控测试集标准答案；不代表开放业务场景的泛化准确率。\n`;
    writeFileSync(OUTPUT_MD, markdown, 'utf8');
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const models = getConfiguredModels();
  if (models.length !== 3) throw new Error(`需要恰好三个模型，当前配置为：${models.join(', ')}`);
  process.env.OLLAMA_KEEP_ALIVE = '10m';

  const cases = buildCases();
  let state: BenchmarkState;
  if (existsSync(OUTPUT_JSON)) {
    state = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8')) as BenchmarkState;
    console.log(`继续运行 ${RUN_ID}，已完成 ${state.records.length}/150 次`);
  } else {
    state = {
      runId: RUN_ID,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      benchmarkNow: BENCHMARK_NOW.toISOString(),
      environment: {
        execution: '按模型分组顺序运行；每组首条冷启动，其余热启动；模型组结束后卸载',
        temperature: 0,
        keepAlive: process.env.OLLAMA_KEEP_ALIVE,
        models,
        totalCases: cases.length,
        totalEvaluations: cases.length * models.length,
      },
      policy: POLICY,
      cases,
      records: [],
    };
    writeArtifacts(state);
  }

  const completed = new Set(state.records.map((record) => `${record.model}\u0000${record.caseId}`));
  for (const model of models) {
    await unloadOllamaModel(model);
    console.log(`\n开始模型：${model}`);
    for (const benchmarkCase of state.cases) {
      const key = `${model}\u0000${benchmarkCase.id}`;
      if (completed.has(key)) continue;

      const totalProgress = state.records.length + 1;
      const modelProgress = state.records.filter((record) => record.model === model).length + 1;
      console.log(`[${modelProgress}/50 例 | 总调用 ${totalProgress}/150] ${model} · ${benchmarkCase.id} · ${benchmarkCase.scenario}`);
      const expected = {
        recommendation: benchmarkCase.expected.deterministic_recommendation,
        riskLevel: benchmarkCase.expected.deterministic_risk,
        missingDocuments: benchmarkCase.expected.missing_documents,
        checks: benchmarkCase.expected.checks,
      };
      try {
        const result = await runClaimAgent(benchmarkCase.claim, model, { policy: POLICY, now: BENCHMARK_NOW });
        const memory = await getOllamaMemory(model);
        const checkComparison = compareChecks(expected.checks, result.assessment.checks);
        const recommendationMatch = result.assessment.recommendation === expected.recommendation;
        const riskMatch = result.assessment.risk_level === expected.riskLevel;
        const missingDocumentsMatch = sameStrings(result.assessment.missing_documents, expected.missingDocuments);
        state.records.push({
          caseId: benchmarkCase.id,
          scenario: benchmarkCase.scenario,
          model,
          success: true,
          expected,
          actual: result.assessment,
          metrics: { ...result.metrics, ...memory },
          traceId: result.traceId,
          guardrailApplied: result.guardrailApplied,
          recommendationMatch,
          riskMatch,
          missingDocumentsMatch,
          exactDecisionMatch: recommendationMatch && riskMatch && missingDocumentsMatch,
          checkCoverage: checkComparison.coverage,
          checkStatusAccuracy: checkComparison.statusAccuracy,
          finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        state.records.push({
          caseId: benchmarkCase.id,
          scenario: benchmarkCase.scenario,
          model,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          expected,
          recommendationMatch: false,
          riskMatch: false,
          missingDocumentsMatch: false,
          exactDecisionMatch: false,
          checkCoverage: 0,
          checkStatusAccuracy: 0,
          finishedAt: new Date().toISOString(),
        });
      }
      completed.add(key);
      writeArtifacts(state);
    }
    await unloadOllamaModel(model);
  }

  writeArtifacts(state, true);
  console.log(`\n评测完成：${OUTPUT_JSON}`);
  console.log(`CSV：${OUTPUT_CSV}`);
  console.log(`报告：${OUTPUT_MD}`);
  console.log(JSON.stringify(state.summaries, null, 2));
}

main().catch((error) => {
  console.error('50 条三模型评测失败：', error);
  process.exitCode = 1;
});
