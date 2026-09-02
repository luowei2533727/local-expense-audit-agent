import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { extractReceiptData, OCRResult } from '../src/services/ocr.service';
import { loadPaddleVatCases, PaddleVatCase } from './lib/paddle-vat-adapter';

const DATASET_SOURCE = 'https://aistudio.baidu.com/datasetdetail/165561';
const DATASET_DOCS = 'https://www.paddleocr.ai/v2.10.0/en/applications/发票关键信息抽取.html';
const DATASET_SHA256 = 'b65bf3b6639758fe98c2c076fbc5b527006a66f01616c2fbe4d36ab06a1a1a1f';
const POLICY: ClaimPolicy = { maxAgeDays: 90, receiptRequiredAbove: 0, highAmountThreshold: 5000 };

type Phase = 'ocr' | 'agent' | 'all';
type Scenario = '原始基线' | '缺少票据' | '高额报销' | '未来日期' | '多重风险';

interface OcrMetrics {
  amountExact: boolean | null;
  amountWithinOnePercent: boolean | null;
  taxAmountExact: boolean | null;
  dateExact: boolean | null;
  invoiceNumberExact: boolean | null;
  buyerNameExact: boolean | null;
  buyerNameContainment: boolean | null;
  buyerNameSimilarity: number | null;
  currencyExact: boolean;
  annotatedTextRecall: number;
}

interface OcrRecord {
  caseId: string;
  split: PaddleVatCase['split'];
  fileName: string;
  success: boolean;
  error?: string;
  latencyMs?: number;
  result?: OCRResult;
  metrics?: OcrMetrics;
  finishedAt: string;
}

interface AgentRecord {
  caseId: string;
  scenario: Scenario;
  model: string;
  success: boolean;
  error?: string;
  expectedRecommendation: ClaimAssessment['recommendation'];
  actualRecommendation?: ClaimAssessment['recommendation'];
  expectedRisk: ClaimAssessment['risk_level'];
  actualRisk?: ClaimAssessment['risk_level'];
  recommendationMatch: boolean;
  riskMatch: boolean;
  missingDocumentsMatch: boolean;
  exactDecisionMatch: boolean;
  checkCoverage: number;
  checkStatusAccuracy: number;
  metrics?: Awaited<ReturnType<typeof runClaimAgent>>['metrics'] & {
    sizeBytes: number | null;
    vramBytes: number | null;
  };
  finishedAt: string;
}

interface BenchmarkState {
  version: 1;
  runId: string;
  startedAt: string;
  updatedAt: string;
  dataset: {
    name: 'PaddleOCR VAT Invoice';
    source: string;
    docs: string;
    archiveSha256: string;
    licenseNote: string;
    trainCount: number;
    valCount: number;
  };
  config: {
    limit: number;
    ocrModel: string;
    ocrMaxEdge: number;
    ocrTimeoutMs: number;
    agentModels: string[];
    policy: ClaimPolicy;
  };
  cases: PaddleVatCase[];
  ocrRecords: OcrRecord[];
  agentRecords: AgentRecord[];
  finishedPhases: Phase[];
}

function argument(name: string, fallback: string): string {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

const phase = argument('phase', 'all') as Phase;
if (!['ocr', 'agent', 'all'].includes(phase)) throw new Error('--phase 必须是 ocr、agent 或 all');
const limit = Math.max(1, Math.min(38, Number(argument('limit', '38')) || 38));
const ocrModel = argument('ocr-model', process.env.OLLAMA_VISION_MODEL || 'qwen3.5:4b');
const ocrMaxEdge = Number(argument('ocr-max-edge', process.env.OLLAMA_OCR_MAX_EDGE || '2048'));
if (!Number.isFinite(ocrMaxEdge) || ocrMaxEdge < 768 || ocrMaxEdge > 4096) {
  throw new Error('--ocr-max-edge 必须在 768 到 4096 之间');
}
const ocrTimeoutMs = Number(argument('ocr-timeout-ms', process.env.OLLAMA_OCR_TIMEOUT_MS || '300000'));
if (!Number.isFinite(ocrTimeoutMs) || ocrTimeoutMs < 60_000 || ocrTimeoutMs > 600_000) {
  throw new Error('--ocr-timeout-ms 必须在 60000 到 600000 之间');
}
const agentModels = argument('models', getConfiguredModels().join(','))
  .split(',').map((item) => item.trim()).filter(Boolean);
if (agentModels.length !== 3 || new Set(agentModels).size !== 3) throw new Error('Agent 评测需要三个不重复模型');

const datasetRoot = resolve(process.cwd(), 'benchmarks', 'datasets', 'paddle-vat', 'zzsfp');
const outputRoot = resolve(process.cwd(), 'benchmarks', 'real');
const runId = argument('run-id', `paddle-vat-real-n${limit}-v1`);
const jsonPath = resolve(outputRoot, `${runId}.json`);
const ocrCsvPath = resolve(outputRoot, `${runId}-ocr.csv`);
const agentCsvPath = resolve(outputRoot, `${runId}-agent.csv`);
const reportPath = resolve(outputRoot, `${runId}.md`);

function normalizeText(value: string | null | undefined): string {
  return (value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeIdentifier(value: string | null | undefined): string {
  return normalizeText(value).replace(/[o〇]/g, '0').replace(/[il]/g, '1');
}

function levenshtein(left: string, right: string): number {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function textSimilarity(left: string, right: string): number {
  const expected = normalizeText(left);
  const actual = normalizeText(right);
  return Number((1 - levenshtein(expected, actual) / Math.max(expected.length, actual.length, 1)).toFixed(4));
}

function exactMoney(actual: number | null, expected: number | null): boolean | null {
  if (expected == null) return null;
  return actual != null && Math.abs(actual - expected) <= 0.01;
}

function withinOnePercent(actual: number | null, expected: number | null): boolean | null {
  if (expected == null) return null;
  return actual != null && Math.abs(actual - expected) <= Math.max(0.01, Math.abs(expected) * 0.01);
}

function exactText(actual: string | null, expected: string | null): boolean | null {
  if (!expected) return null;
  return normalizeText(actual) === normalizeText(expected);
}

function annotatedTextRecall(item: PaddleVatCase, prediction: string): number {
  const actual = normalizeText(prediction);
  const values = item.pairs.flatMap((pair) => [pair.question, pair.answer])
    .map(normalizeText).filter(Boolean);
  return values.length ? values.filter((value) => actual.includes(value)).length / values.length : 0;
}

function evaluateOcr(item: PaddleVatCase, result: OCRResult): OcrMetrics {
  const expectedBuyer = normalizeText(item.buyerName);
  const actualBuyer = normalizeText(result.buyer_name);
  return {
    amountExact: exactMoney(result.amount, item.amount),
    amountWithinOnePercent: withinOnePercent(result.amount, item.amount),
    taxAmountExact: exactMoney(result.tax_amount, item.taxAmount),
    dateExact: exactText(result.date, item.date),
    invoiceNumberExact: item.invoiceNumber
      ? normalizeIdentifier(result.invoice_number) === normalizeIdentifier(item.invoiceNumber)
      : null,
    buyerNameExact: exactText(result.buyer_name, item.buyerName),
    buyerNameContainment: item.buyerName
      ? Boolean(actualBuyer && (actualBuyer.includes(expectedBuyer) || expectedBuyer.includes(actualBuyer)))
      : null,
    buyerNameSimilarity: item.buyerName ? textSimilarity(item.buyerName, result.buyer_name || '') : null,
    currencyExact: result.currency === 'CNY',
    annotatedTextRecall: annotatedTextRecall(item, result.raw_text),
  };
}

function referenceContext(item: PaddleVatCase): { claim: ClaimSnapshot; now: Date } {
  const expenseDate = item.date || '2016-06-12';
  const parsed = new Date(`${expenseDate}T00:00:00.000Z`);
  const now = new Date(parsed.getTime() + 30 * 86_400_000);
  return {
    claim: {
      id: `paddle-vat-${item.id}`,
      amount: item.amount || 100,
      currency: 'CNY',
      convertedAmount: null,
      baseCurrency: 'CNY',
      category: 'Other',
      description: '中国增值税发票报销',
      expenseDate: parsed.toISOString(),
      // The public labels omit the seller field. Use an explicit benchmark
      // placeholder instead of incorrectly treating the buyer as the merchant.
      merchantName: '公开数据集销售方（原始标注未覆盖名称）',
      receiptPresent: true,
      submittedAt: now.toISOString(),
    },
    now,
  };
}

function scenarioClaim(item: PaddleVatCase, index: number): { scenario: Scenario; claim: ClaimSnapshot; now: Date } {
  const reference = referenceContext(item);
  const scenarios: Scenario[] = ['原始基线', '缺少票据', '高额报销', '未来日期', '多重风险'];
  const scenario = scenarios[index % scenarios.length];
  const claim = { ...reference.claim };
  if (scenario === '缺少票据') claim.receiptPresent = false;
  if (scenario === '高额报销') claim.amount = Math.max(claim.amount, 8000);
  if (scenario === '未来日期') claim.expenseDate = new Date(reference.now.getTime() + 5 * 86_400_000).toISOString();
  if (scenario === '多重风险') {
    claim.amount = Math.max(claim.amount, 20_000);
    claim.currency = 'XX';
    claim.category = 'Personal';
    claim.description = '个人用途';
    claim.merchantName = null;
    claim.receiptPresent = false;
    claim.expenseDate = new Date(reference.now.getTime() + 5 * 86_400_000).toISOString();
  }
  return { scenario, claim, now: reference.now };
}

function compareChecks(expected: ClaimAssessment['checks'], actual: ClaimAssessment['checks']): { coverage: number; accuracy: number } {
  const byName = new Map(actual.map((item) => [item.name, item]));
  const covered = expected.filter((item) => byName.has(item.name)).length;
  const correct = expected.filter((item) => byName.get(item.name)?.status === item.status).length;
  return { coverage: covered / Math.max(expected.length, 1), accuracy: correct / Math.max(expected.length, 1) };
}

function sameStrings(left: string[], right: string[]): boolean {
  return [...left].sort().join('\0') === [...right].sort().join('\0');
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

function rate<T>(rows: T[], predicate: (row: T) => boolean): number {
  return rows.length ? rows.filter(predicate).length / rows.length : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function nullableRate(rows: Array<OcrRecord & { metrics: OcrMetrics }>, key: keyof OcrMetrics): string {
  const values = rows.map((row) => row.metrics[key]).filter((value): value is boolean => typeof value === 'boolean');
  return values.length ? `${percent(rate(values, Boolean))}（n=${values.length}）` : 'N/A（无标注）';
}

function durationText(milliseconds: number): string {
  const totalMinutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

function csv(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function writeArtifacts(state: BenchmarkState): void {
  state.updatedAt = new Date().toISOString();
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const ocrHeader = ['caseId', 'split', 'fileName', 'success', 'latencyMs', 'amountExact', 'amountWithinOnePercent', 'taxAmountExact', 'dateExact', 'invoiceNumberExact', 'buyerNameExact', 'buyerNameContainment', 'buyerNameSimilarity', 'currencyExact', 'annotatedTextRecall', 'error'];
  const ocrRows = state.ocrRecords.map((row) => [
    row.caseId, row.split, row.fileName, row.success, row.latencyMs,
    row.metrics?.amountExact, row.metrics?.amountWithinOnePercent, row.metrics?.taxAmountExact,
    row.metrics?.dateExact, row.metrics?.invoiceNumberExact, row.metrics?.buyerNameExact,
    row.metrics?.buyerNameContainment, row.metrics?.buyerNameSimilarity, row.metrics?.currencyExact,
    row.metrics?.annotatedTextRecall, row.error,
  ].map(csv).join(','));
  writeFileSync(ocrCsvPath, `\uFEFF${ocrHeader.map(csv).join(',')}\n${ocrRows.join('\n')}\n`, 'utf8');

  const agentHeader = ['caseId', 'scenario', 'model', 'success', 'expectedRecommendation', 'actualRecommendation', 'expectedRisk', 'actualRisk', 'recommendationMatch', 'riskMatch', 'missingDocumentsMatch', 'exactDecisionMatch', 'checkCoverage', 'checkStatusAccuracy', 'latencyMs', 'firstTokenMs', 'tokensPerSecond', 'repairAttempts', 'error'];
  const agentRows = state.agentRecords.map((row) => [
    row.caseId, row.scenario, row.model, row.success, row.expectedRecommendation, row.actualRecommendation,
    row.expectedRisk, row.actualRisk, row.recommendationMatch, row.riskMatch, row.missingDocumentsMatch,
    row.exactDecisionMatch, row.checkCoverage, row.checkStatusAccuracy, row.metrics?.latencyMs,
    row.metrics?.firstTokenMs, row.metrics?.tokensPerSecond, row.metrics?.repairAttempts, row.error,
  ].map(csv).join(','));
  writeFileSync(agentCsvPath, `\uFEFF${agentHeader.map(csv).join(',')}\n${agentRows.join('\n')}\n`, 'utf8');

  const ocrSuccess = state.ocrRecords.filter(
    (row): row is OcrRecord & { metrics: OcrMetrics; latencyMs: number } => Boolean(row.success && row.metrics && row.latencyMs != null),
  );
  const ocrLatencies = ocrSuccess.map((row) => row.latencyMs);
  const buyerSimilarities = ocrSuccess.map((row) => row.metrics.buyerNameSimilarity)
    .filter((value): value is number => value != null);
  const completedAt = [...state.ocrRecords, ...state.agentRecords]
    .map((row) => Date.parse(row.finishedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0]
    || Date.parse(state.updatedAt);
  const runDuration = durationText(Math.max(0, completedAt - Date.parse(state.startedAt)));
  const modelRows = state.config.agentModels.map((model) => {
    const rows = state.agentRecords.filter((row) => row.model === model);
    const successes = rows.filter((row) => row.success && row.metrics);
    if (!rows.length) return `| ${model} | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |`;
    const firstTokenValues = successes.map((row) => row.metrics!.firstTokenMs)
      .filter((value): value is number => value != null);
    return `| ${model} | ${successes.length}/${rows.length} | ${percent(rate(rows, (row) => row.exactDecisionMatch))} | ${percent(mean(rows.map((row) => row.checkCoverage)))} | ${percent(mean(rows.map((row) => row.checkStatusAccuracy)))} | ${(mean(successes.map((row) => row.metrics!.latencyMs)) / 1000).toFixed(2)}s | ${(percentile(successes.map((row) => row.metrics!.latencyMs), 0.95) / 1000).toFixed(2)}s | ${firstTokenValues.length ? `${(mean(firstTokenValues) / 1000).toFixed(2)}s` : 'N/A'} | ${mean(successes.map((row) => row.metrics!.tokensPerSecond)).toFixed(2)} | ${percent(rate(successes, (row) => (row.metrics?.repairAttempts || 0) > 0))} |`;
  }).join('\n');
  const scenarios: Scenario[] = ['原始基线', '缺少票据', '高额报销', '未来日期', '多重风险'];
  const scenarioRows = state.config.agentModels.flatMap((model) => scenarios.map((scenario) => {
    const rows = state.agentRecords.filter((row) => row.model === model && row.scenario === scenario);
    return `| ${model} | ${scenario} | ${rows.length ? `${rows.filter((row) => row.exactDecisionMatch).length}/${rows.length}` : 'N/A'} | ${rows.length ? percent(mean(rows.map((row) => row.checkCoverage))) : 'N/A'} | ${rows.length ? percent(mean(rows.map((row) => row.checkStatusAccuracy))) : 'N/A'} |`;
  })).join('\n');

  const report = `# 中国增值税发票基准测试\n\n`
    + `- 数据集：PaddleOCR 增值税发票关键信息抽取数据集\n- AI Studio：${DATASET_SOURCE}\n- 官方说明：${DATASET_DOCS}\n`
    + `- 归档 SHA-256：${DATASET_SHA256}\n- 样本：${state.cases.length} 张（train ${state.dataset.trainCount} / val ${state.dataset.valCount}）\n`
    + `- OCR 模型：${state.config.ocrModel}（长边 ${state.config.ocrMaxEdge}px，单张超时 ${Math.round(state.config.ocrTimeoutMs / 1000)}s）\n`
    + `- Agent 模型：${state.config.agentModels.join('、')}\n- 完整运行耗时：${runDuration}\n`
    + `- 许可：${state.dataset.licenseNote}\n\n`
    + `## OCR 指标\n\n`
    + `- 结构化成功：${state.ocrRecords.filter((row) => row.success).length}/${state.ocrRecords.length || state.cases.length}\n`
    + `- 价税合计严格准确率：${nullableRate(ocrSuccess, 'amountExact')}\n`
    + `- 价税合计 1% 容差准确率：${nullableRate(ocrSuccess, 'amountWithinOnePercent')}\n`
    + `- 税额严格准确率：${nullableRate(ocrSuccess, 'taxAmountExact')}\n`
    + `- 开票日期严格准确率：${nullableRate(ocrSuccess, 'dateExact')}\n`
    + `- 发票号码严格准确率：${nullableRate(ocrSuccess, 'invoiceNumberExact')}\n`
    + `- 购买方名称严格准确率：${nullableRate(ocrSuccess, 'buyerNameExact')}\n`
    + `- 购买方名称包含匹配率：${nullableRate(ocrSuccess, 'buyerNameContainment')}\n`
    + `- 购买方名称平均字符相似度：${buyerSimilarities.length ? percent(mean(buyerSimilarities)) : 'N/A'}\n`
    + `- 币种准确率：${ocrSuccess.length ? percent(rate(ocrSuccess, (row) => row.metrics.currencyExact)) : 'N/A'}（CNY 由数据集票种可靠派生）\n`
    + `- 标注文本平均召回率：${ocrSuccess.length ? percent(mean(ocrSuccess.map((row) => row.metrics.annotatedTextRecall))) : 'N/A'}\n`
    + `- OCR 平均/P95耗时：${ocrSuccess.length ? `${(mean(ocrLatencies) / 1000).toFixed(2)}s / ${(percentile(ocrLatencies, 0.95) / 1000).toFixed(2)}s` : 'N/A'}\n\n`
    + `> 官方结构化标注不包含销售方名称和发票代码，这两个字段不纳入准确率。标注文本召回率只检查已标注文字。\n\n`
    + `## 三模型 Agent 规则执行指标\n\n`
    + `真实发票金额和日期作为基线，并以固定方式构造缺票、高额、未来日期和多重风险。标准答案由确定性规则引擎生成；本节衡量工具调用、结构化输出和规则复现能力，不代表欺诈识别准确率。\n\n`
    + `| 模型 | 结构化成功 | 完整决策准确率 | 检查覆盖率 | 检查状态准确率 | 平均耗时 | P95耗时 | 平均TTFT | Token/s | 修复率 |\n`
    + `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${modelRows}\n\n`
    + `### 分场景结果\n\n`
    + `| 模型 | 场景 | 完整决策命中 | 检查覆盖率 | 检查状态准确率 |\n`
    + `|---|---|---:|---:|---:|\n${scenarioRows}\n\n`
    + `> 完整决策要求建议、风险等级和缺失材料同时正确。所有模型输出仍需人工审批，确定性规则保护会阻止模型把风险降级。\n`;
  writeFileSync(reportPath, report, 'utf8');
}

function loadCases(): PaddleVatCase[] {
  if (!existsSync(datasetRoot)) throw new Error('找不到 PaddleOCR 发票数据，请先运行 pnpm dataset:paddle-vat');
  const all = loadPaddleVatCases(datasetRoot).sort((left, right) => left.fileName.localeCompare(right.fileName));
  return all.slice(0, limit);
}

function loadOrCreateState(cases: PaddleVatCase[]): BenchmarkState {
  if (existsSync(jsonPath)) {
    const existing = JSON.parse(readFileSync(jsonPath, 'utf8')) as BenchmarkState;
    if (existing.config.limit !== limit || existing.config.ocrModel !== ocrModel
      || existing.config.ocrMaxEdge !== ocrMaxEdge || existing.config.ocrTimeoutMs !== ocrTimeoutMs
      || existing.config.agentModels.join(',') !== agentModels.join(',')) {
      throw new Error(`运行配置与已有 ${jsonPath} 不一致，请更换 --run-id`);
    }
    return existing;
  }
  return {
    version: 1,
    runId,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataset: {
      name: 'PaddleOCR VAT Invoice', source: DATASET_SOURCE, docs: DATASET_DOCS,
      archiveSha256: DATASET_SHA256, licenseNote: 'AI Studio 页面标注为 CC BY-SA；原始图片不随本项目分发。',
      trainCount: cases.filter((item) => item.split === 'train').length,
      valCount: cases.filter((item) => item.split === 'val').length,
    },
    config: { limit, ocrModel, ocrMaxEdge, ocrTimeoutMs, agentModels, policy: POLICY },
    cases,
    ocrRecords: [],
    agentRecords: [],
    finishedPhases: [],
  };
}

async function runOcr(state: BenchmarkState): Promise<void> {
  const done = new Set(state.ocrRecords.map((row) => row.caseId));
  for (const [index, item] of state.cases.entries()) {
    if (done.has(item.id)) continue;
    console.log(`[OCR ${index + 1}/${state.cases.length}] ${item.fileName}`);
    const started = Date.now();
    try {
      const result = await extractReceiptData(readFileSync(item.imagePath).toString('base64'), 'image/jpeg', {
        model: ocrModel, keepAlive: '10m', maxEdge: ocrMaxEdge, timeoutMs: ocrTimeoutMs,
      });
      state.ocrRecords.push({
        caseId: item.id, split: item.split, fileName: item.fileName, success: true,
        latencyMs: Date.now() - started, result, metrics: evaluateOcr(item, result), finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      state.ocrRecords.push({
        caseId: item.id, split: item.split, fileName: item.fileName, success: false,
        latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
    }
    done.add(item.id);
    writeArtifacts(state);
  }
  await unloadOllamaModel(ocrModel);
  if (!state.finishedPhases.includes('ocr')) state.finishedPhases.push('ocr');
  writeArtifacts(state);
}

async function runAgent(state: BenchmarkState): Promise<void> {
  const done = new Set(state.agentRecords.map((row) => `${row.model}\0${row.caseId}`));
  process.env.OLLAMA_KEEP_ALIVE = '10m';
  for (const model of state.config.agentModels) {
    await unloadOllamaModel(model);
    for (const [index, item] of state.cases.entries()) {
      const key = `${model}\0${item.id}`;
      if (done.has(key)) continue;
      const prepared = scenarioClaim(item, index);
      const expected = evaluateClaimRules(prepared.claim, POLICY, prepared.now);
      console.log(`[Agent ${model} ${index + 1}/${state.cases.length}] ${item.id} · ${prepared.scenario}`);
      try {
        const result = await runClaimAgent(prepared.claim, model, { policy: POLICY, now: prepared.now });
        const memory = await getOllamaMemory(model);
        const checks = compareChecks(expected.checks, result.assessment.checks);
        const recommendationMatch = result.assessment.recommendation === expected.deterministic_recommendation;
        const riskMatch = result.assessment.risk_level === expected.deterministic_risk;
        const missingDocumentsMatch = sameStrings(result.assessment.missing_documents, expected.missing_documents);
        state.agentRecords.push({
          caseId: item.id, scenario: prepared.scenario, model, success: true,
          expectedRecommendation: expected.deterministic_recommendation,
          actualRecommendation: result.assessment.recommendation,
          expectedRisk: expected.deterministic_risk, actualRisk: result.assessment.risk_level,
          recommendationMatch, riskMatch, missingDocumentsMatch,
          exactDecisionMatch: recommendationMatch && riskMatch && missingDocumentsMatch,
          checkCoverage: checks.coverage, checkStatusAccuracy: checks.accuracy,
          metrics: { ...result.metrics, ...memory }, finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        state.agentRecords.push({
          caseId: item.id, scenario: prepared.scenario, model, success: false,
          error: error instanceof Error ? error.message : String(error),
          expectedRecommendation: expected.deterministic_recommendation, expectedRisk: expected.deterministic_risk,
          recommendationMatch: false, riskMatch: false, missingDocumentsMatch: false,
          exactDecisionMatch: false, checkCoverage: 0, checkStatusAccuracy: 0, finishedAt: new Date().toISOString(),
        });
      }
      done.add(key);
      writeArtifacts(state);
    }
    await unloadOllamaModel(model);
  }
  if (!state.finishedPhases.includes('agent')) state.finishedPhases.push('agent');
  writeArtifacts(state);
}

async function main(): Promise<void> {
  mkdirSync(outputRoot, { recursive: true });
  const state = loadOrCreateState(loadCases());
  writeArtifacts(state);
  if (phase === 'ocr' || phase === 'all') await runOcr(state);
  if (phase === 'agent' || phase === 'all') await runAgent(state);
  if (phase === 'all' && !state.finishedPhases.includes('all')) state.finishedPhases.push('all');
  writeArtifacts(state);
  console.log(`PaddleOCR 真实发票评测完成或已保存：${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
