import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
import { selectTotalAnnotation, type WildReceiptAnnotation } from './lib/wildreceipt-adapter';

const DATASET_SHA256 = 'f47646e16033d95c85a0b3a180a39d90cc354a729e51a280211b2fe7cae532bd';
const POLICY: ClaimPolicy = { maxAgeDays: 90, receiptRequiredAbove: 0, highAmountThreshold: 1000 };
const DATASET_SOURCE = 'https://download.openmmlab.com/mmocr/data/wildreceipt.tar';

type Phase = 'ocr' | 'agent' | 'all';
type Scenario = '真实原样' | '缺少票据' | '高额报销' | '未来日期' | '多重风险';

type RawAnnotation = WildReceiptAnnotation;

interface RawReceipt {
  file_name: string;
  height: number;
  width: number;
  annotations: RawAnnotation[];
}

interface RealCase {
  id: string;
  fileName: string;
  imagePath: string;
  merchant: string;
  total: number;
  totalCandidates: number[];
  totalSelectionMethod: 'single-value' | 'nearest-total-key' | 'first-labeled-value';
  dateText: string | null;
  dateCandidates: string[];
  currency: string | null;
  description: string;
  rawText: string;
}

interface OcrMetrics {
  amountExact: boolean;
  amountWithinOnePercent: boolean;
  merchantExact: boolean;
  merchantContainment: boolean;
  merchantSimilarity: number;
  dateExact: boolean | null;
  currencyExact: boolean | null;
  rawTextCer: number;
  policyRecommendationMatch: boolean;
  policyRiskMatch: boolean;
}

interface OcrRecord {
  caseId: string;
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
    name: 'WildReceipt';
    source: string;
    archiveSha256: string;
    split: 'test';
    licenseNote: string;
  };
  config: {
    seed: string;
    limit: number;
    ocrModel: string;
    ocrMaxEdge: number;
    ocrTimeoutMs: number;
    agentModels: string[];
    policy: ClaimPolicy;
  };
  cases: RealCase[];
  ocrRecords: OcrRecord[];
  agentRecords: AgentRecord[];
  finishedPhases: Phase[];
}

function argument(name: string, fallback: string): string {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

const limit = Math.max(1, Number(argument('limit', '50')) || 50);
const seed = argument('seed', '20260831');
const phase = argument('phase', 'all') as Phase;
if (!['ocr', 'agent', 'all'].includes(phase)) throw new Error('--phase 必须是 ocr、agent 或 all');
const ocrModel = argument('ocr-model', process.env.OLLAMA_VISION_MODEL || 'qwen3.5:4b');
const ocrMaxEdge = Number(argument('ocr-max-edge', process.env.OLLAMA_OCR_MAX_EDGE || '2048'));
if (!Number.isFinite(ocrMaxEdge) || ocrMaxEdge < 768 || ocrMaxEdge > 4096) throw new Error('--ocr-max-edge 必须在 768 到 4096 之间');
const ocrTimeoutMs = Number(argument('ocr-timeout-ms', process.env.OLLAMA_OCR_TIMEOUT_MS || '300000'));
if (!Number.isFinite(ocrTimeoutMs) || ocrTimeoutMs < 60_000 || ocrTimeoutMs > 600_000) throw new Error('--ocr-timeout-ms 必须在 60000 到 600000 之间');
const agentModels = argument('models', getConfiguredModels().join(','))
  .split(',').map((item) => item.trim()).filter(Boolean);
if (agentModels.length !== 3 || new Set(agentModels).size !== 3) throw new Error('Agent评测需要三个不重复模型');

const datasetRoot = resolve(process.cwd(), 'benchmarks', 'datasets', 'wildreceipt', 'wildreceipt');
const annotationsPath = resolve(datasetRoot, 'test.txt');
const outputRoot = resolve(process.cwd(), 'benchmarks', 'real');
const runId = argument('run-id', `wildreceipt-v1-n${limit}-seed${seed}`);
const jsonPath = resolve(outputRoot, `${runId}.json`);
const ocrCsvPath = resolve(outputRoot, `${runId}-ocr.csv`);
const agentCsvPath = resolve(outputRoot, `${runId}-agent.csv`);
const reportPath = resolve(outputRoot, `${runId}.md`);

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
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
  const a = normalizeText(left);
  const b = normalizeText(right);
  const denominator = Math.max(a.length, b.length, 1);
  return Number((1 - levenshtein(a, b) / denominator).toFixed(4));
}

function characterErrorRate(reference: string, prediction: string): number {
  const expected = normalizeText(reference);
  const actual = normalizeText(prediction);
  return Number((levenshtein(expected, actual) / Math.max(expected.length, 1)).toFixed(4));
}

function dateCandidates(text: string): string[] {
  const compact = text.normalize('NFKC').replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = compact.split('-').filter(Boolean);
  if (parts.length < 3) return [];
  const [a, b, c] = parts;
  const results = new Set<string>();
  const add = (year: number, month: number, day: number) => {
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      results.add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  };
  if (a.length === 4) add(Number(a), Number(b), Number(c));
  else if (c.length === 4 || c.length === 2) {
    add(Number(c), Number(b), Number(a));
    add(Number(c), Number(a), Number(b));
  }
  return [...results];
}

function inferCurrency(text: string): string | null {
  const upper = text.normalize('NFKC').toUpperCase();
  const explicit: Array<[RegExp, string]> = [
    [/\bEUR\b|€/u, 'EUR'], [/\bGBP\b|£/u, 'GBP'], [/\bUSD\b/, 'USD'],
    [/\bJPY\b|¥/u, 'JPY'], [/\bCNY\b|RMB|人民币/u, 'CNY'], [/\bKRW\b|₩/u, 'KRW'],
    [/\bCAD\b/, 'CAD'], [/\bAUD\b/, 'AUD'],
  ];
  for (const [pattern, code] of explicit) if (pattern.test(upper)) return code;
  return upper.includes('$') ? 'USD' : null;
}

function readingOrder(annotations: RawAnnotation[]): RawAnnotation[] {
  return [...annotations].sort((left, right) => {
    const leftY = Math.min(left.box[1] || 0, left.box[3] || 0, left.box[5] || 0, left.box[7] || 0);
    const rightY = Math.min(right.box[1] || 0, right.box[3] || 0, right.box[5] || 0, right.box[7] || 0);
    if (Math.abs(leftY - rightY) > 8) return leftY - rightY;
    return Math.min(left.box[0] || 0, left.box[2] || 0) - Math.min(right.box[0] || 0, right.box[2] || 0);
  });
}

function toCase(receipt: RawReceipt): RealCase | null {
  const values = (label: number) => receipt.annotations.filter((item) => item.label === label && item.text.trim()).map((item) => item.text.trim());
  const merchant = values(1).join(' ').trim();
  const selectedTotal = selectTotalAnnotation(receipt.annotations, receipt.width, receipt.height);
  if (!merchant || !selectedTotal) return null;
  const dateText = values(7).join(' ').trim() || null;
  const orderedText = readingOrder(receipt.annotations).map((item) => item.text.trim()).filter(Boolean).join('\n');
  const productText = values(11).slice(0, 3).join('、');
  return {
    id: basename(receipt.file_name).replace(/\.[^.]+$/, ''),
    fileName: receipt.file_name,
    imagePath: resolve(datasetRoot, receipt.file_name),
    merchant,
    total: selectedTotal.total,
    totalCandidates: selectedTotal.candidates,
    totalSelectionMethod: selectedTotal.method,
    dateText,
    dateCandidates: dateText ? dateCandidates(dateText) : [],
    currency: inferCurrency(orderedText),
    description: productText ? `真实票据项目：${productText}` : '真实票据消费记录',
    rawText: orderedText,
  };
}

function loadCases(): RealCase[] {
  if (!existsSync(annotationsPath)) throw new Error('找不到 WildReceipt，请先运行 pnpm dataset:wildreceipt');
  const candidates = readFileSync(annotationsPath, 'utf8').trim().split(/\r?\n/)
    .map((line) => toCase(JSON.parse(line) as RawReceipt))
    .filter((item): item is RealCase => Boolean(item && existsSync(item.imagePath)))
    .sort((left, right) => sha256(`${seed}\0${left.fileName}`).localeCompare(sha256(`${seed}\0${right.fileName}`)));
  if (candidates.length < limit) throw new Error(`满足商户和总金额标注的测试样本只有 ${candidates.length} 条`);
  return candidates.slice(0, limit);
}

function referenceContext(item: RealCase): { claim: ClaimSnapshot; now: Date } {
  const expenseDate = item.dateCandidates[0] || '2026-08-01';
  const parsed = new Date(`${expenseDate}T00:00:00.000Z`);
  const now = new Date(parsed.getTime() + 30 * 86_400_000);
  return {
    claim: {
      id: `wildreceipt-${item.id}`,
      amount: item.total,
      currency: item.currency || 'USD',
      convertedAmount: null,
      baseCurrency: item.currency || 'USD',
      category: 'Other',
      description: item.description,
      expenseDate: parsed.toISOString(),
      merchantName: item.merchant,
      receiptPresent: true,
      submittedAt: now.toISOString(),
    },
    now,
  };
}

function policyAgreement(item: RealCase, result: OCRResult): Pick<OcrMetrics, 'policyRecommendationMatch' | 'policyRiskMatch'> {
  const reference = referenceContext(item);
  const expected = evaluateClaimRules(reference.claim, POLICY, reference.now);
  const extracted: ClaimSnapshot = {
    ...reference.claim,
    amount: result.amount ?? Number.NaN,
    // WildReceipt does not consistently label currency/date. Do not turn an
    // unavailable ground-truth field into a false end-to-end policy failure.
    currency: item.currency ? result.currency || '' : reference.claim.currency,
    expenseDate: item.dateCandidates.length
      ? result.date ? `${result.date}T00:00:00.000Z` : 'invalid'
      : reference.claim.expenseDate,
    merchantName: result.merchant_name,
  };
  const actual = evaluateClaimRules(extracted, POLICY, reference.now);
  return {
    policyRecommendationMatch: actual.deterministic_recommendation === expected.deterministic_recommendation,
    policyRiskMatch: actual.deterministic_risk === expected.deterministic_risk,
  };
}

function evaluateOcr(item: RealCase, result: OCRResult): OcrMetrics {
  const amountDelta = result.amount == null ? Number.POSITIVE_INFINITY : Math.abs(result.amount - item.total);
  const predictedDate = result.date ? dateCandidates(result.date) : [];
  const agreement = policyAgreement(item, result);
  return {
    amountExact: amountDelta <= 0.01,
    amountWithinOnePercent: amountDelta <= Math.max(0.01, item.total * 0.01),
    merchantExact: normalizeText(result.merchant_name) === normalizeText(item.merchant),
    merchantContainment: Boolean(
      normalizeText(result.merchant_name)
      && (normalizeText(result.merchant_name).includes(normalizeText(item.merchant))
        || normalizeText(item.merchant).includes(normalizeText(result.merchant_name))),
    ),
    merchantSimilarity: textSimilarity(item.merchant, result.merchant_name || ''),
    dateExact: item.dateCandidates.length ? predictedDate.some((value) => item.dateCandidates.includes(value)) : null,
    currencyExact: item.currency ? result.currency === item.currency : null,
    rawTextCer: characterErrorRate(item.rawText, result.raw_text),
    ...agreement,
  };
}

function scenarioClaim(item: RealCase, index: number): { scenario: Scenario; claim: ClaimSnapshot; now: Date } {
  const reference = referenceContext(item);
  const scenarios: Scenario[] = ['真实原样', '缺少票据', '高额报销', '未来日期', '多重风险'];
  const scenario = scenarios[index % scenarios.length];
  const claim = { ...reference.claim };
  if (scenario === '缺少票据') claim.receiptPresent = false;
  if (scenario === '高额报销') claim.amount = Math.max(claim.amount, 1500);
  if (scenario === '未来日期') claim.expenseDate = new Date(reference.now.getTime() + 5 * 86_400_000).toISOString();
  if (scenario === '多重风险') {
    claim.amount = Math.max(claim.amount, 5000);
    claim.currency = 'XX';
    claim.category = 'Personal';
    claim.description = '个人';
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

  const ocrHeader = ['caseId', 'fileName', 'success', 'latencyMs', 'amountExact', 'amountWithinOnePercent', 'merchantExact', 'merchantContainment', 'merchantSimilarity', 'dateExact', 'currencyExact', 'rawTextCer', 'policyRecommendationMatch', 'policyRiskMatch', 'error'];
  const ocrRows = state.ocrRecords.map((row) => [
    row.caseId, row.fileName, row.success, row.latencyMs, row.metrics?.amountExact,
    row.metrics?.amountWithinOnePercent, row.metrics?.merchantExact, row.metrics?.merchantContainment, row.metrics?.merchantSimilarity,
    row.metrics?.dateExact, row.metrics?.currencyExact, row.metrics?.rawTextCer,
    row.metrics?.policyRecommendationMatch, row.metrics?.policyRiskMatch, row.error,
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

  const ocrSuccess = state.ocrRecords.filter((row): row is OcrRecord & { metrics: OcrMetrics; latencyMs: number } => Boolean(row.success && row.metrics && row.latencyMs != null));
  const dateRows = ocrSuccess.filter((row) => row.metrics.dateExact != null);
  const currencyRows = ocrSuccess.filter((row) => row.metrics.currencyExact != null);
  const ocrLatencies = ocrSuccess.map((row) => row.latencyMs);
  const ambiguousTotals = state.cases.filter((item) => item.totalCandidates.length > 1).length;
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
  const scenarios: Scenario[] = ['真实原样', '缺少票据', '高额报销', '未来日期', '多重风险'];
  const scenarioRows = state.config.agentModels.flatMap((model) => scenarios.map((scenario) => {
    const rows = state.agentRecords.filter((row) => row.model === model && row.scenario === scenario);
    return `| ${model} | ${scenario} | ${rows.length ? `${rows.filter((row) => row.exactDecisionMatch).length}/${rows.length}` : 'N/A'} | ${rows.length ? percent(mean(rows.map((row) => row.checkCoverage))) : 'N/A'} | ${rows.length ? percent(mean(rows.map((row) => row.checkStatusAccuracy))) : 'N/A'} |`;
  })).join('\n');

  const report = `# WildReceipt 票据基准测试\n\n`
    + `- 数据集：WildReceipt test split（真实场景票据）\n- 来源：${DATASET_SOURCE}\n`
    + `- 归档 SHA-256：${DATASET_SHA256}\n- 样本：${state.cases.length} 条（seed=${state.config.seed}）\n`
    + `- OCR 模型：${state.config.ocrModel}（自动旋转，长边不超过 ${state.config.ocrMaxEdge}px，单张超时 ${Math.round(state.config.ocrTimeoutMs / 1000)}s）\n- Agent 模型：${state.config.agentModels.join('、')}\n`
    + `- 总金额标注消歧：${ambiguousTotals} 条存在多个 Total_value，按与 Total_key 的空间距离选择\n`
    + `- 完整运行耗时：${runDuration}（OCR 50 次 + Agent ${state.agentRecords.length} 次）\n`
    + `- 许可提示：官方分发文档未明确数据集许可，本地研究评测使用，不随项目分发。\n\n`
    + `## OCR 指标\n\n`
    + `- 完成：${state.ocrRecords.length}/${state.cases.length}，结构化成功：${percent(rate(state.ocrRecords, (row) => row.success))}\n`
    + `- 总金额严格准确率：${percent(rate(ocrSuccess, (row) => row.metrics.amountExact))}\n`
    + `- 总金额 1% 容差准确率：${percent(rate(ocrSuccess, (row) => row.metrics.amountWithinOnePercent))}\n`
    + `- 商户严格准确率：${percent(rate(ocrSuccess, (row) => row.metrics.merchantExact))}\n`
    + `- 商户包含匹配率：${percent(rate(ocrSuccess, (row) => row.metrics.merchantContainment))}（允许品牌名与完整门店名互相包含）\n`
    + `- 商户平均字符相似度：${percent(mean(ocrSuccess.map((row) => row.metrics.merchantSimilarity)))}\n`
    + `- 日期准确率：${dateRows.length ? percent(rate(dateRows, (row) => row.metrics.dateExact === true)) : 'N/A'}（有日期标注 ${dateRows.length} 条）\n`
    + `- 币种准确率：${currencyRows.length ? percent(rate(currencyRows, (row) => row.metrics.currencyExact === true)) : 'N/A'}（可推断币种 ${currencyRows.length} 条）\n`
    + `- 平均字符错误率 CER：${percent(mean(ocrSuccess.map((row) => row.metrics.rawTextCer)))}\n`
    + `- OCR→规则建议一致率：${percent(rate(ocrSuccess, (row) => row.metrics.policyRecommendationMatch))}\n`
    + `- OCR→规则风险一致率：${percent(rate(ocrSuccess, (row) => row.metrics.policyRiskMatch))}\n`
    + `- OCR平均/P95耗时：${(mean(ocrLatencies) / 1000).toFixed(2)}s / ${(percentile(ocrLatencies, 0.95) / 1000).toFixed(2)}s\n\n`
    + `> OCR 指标仅覆盖 WildReceipt 提供或可可靠派生的商户、总金额、日期、币种和全文标注。数据集不包含费用类别标签，该字段不纳入评测。\n\n`
    + `## Agent 规则执行指标\n\n`
    + `真实票据字段作为基线，并以可审计方式注入缺票、高额、未来日期和多重风险。标准答案来自同一确定性规则函数，用于评估工具调用与结构化复现，不代表真实欺诈识别准确率。\n\n`
    + `| 模型 | 结构化成功 | 完整决策准确率 | 检查覆盖率 | 检查状态准确率 | 平均耗时 | P95耗时 | 平均TTFT | Token/s | 修复率 |\n`
    + `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${modelRows}\n\n`
    + `### 分场景结果\n\n`
    + `| 模型 | 场景 | 完整决策命中 | 检查覆盖率 | 检查状态准确率 |\n`
    + `|---|---|---:|---:|---:|\n${scenarioRows}\n\n`
    + `> 完整决策要求建议、风险等级、缺失材料三项同时正确。检查覆盖率独立统计判断依据的完整性；修复率表示首次输出未通过 Schema、经一次格式修复后成功的比例。\n`;
  writeFileSync(reportPath, report, 'utf8');
}

function loadOrCreateState(cases: RealCase[]): BenchmarkState {
  if (existsSync(jsonPath)) {
    const existing = JSON.parse(readFileSync(jsonPath, 'utf8')) as BenchmarkState;
    if (existing.config.seed !== seed || existing.config.limit !== limit || existing.config.ocrModel !== ocrModel
      || existing.config.ocrMaxEdge !== ocrMaxEdge
      || existing.config.ocrTimeoutMs !== ocrTimeoutMs
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
      name: 'WildReceipt', source: DATASET_SOURCE, archiveSha256: DATASET_SHA256, split: 'test',
      licenseNote: 'Upstream distributor does not state a dataset license; local evaluation only; do not redistribute.',
    },
    config: { seed, limit, ocrModel, ocrMaxEdge, ocrTimeoutMs, agentModels, policy: POLICY },
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
      const image = readFileSync(item.imagePath).toString('base64');
      const result = await extractReceiptData(image, 'image/jpeg', {
        model: ocrModel, keepAlive: '10m', maxEdge: ocrMaxEdge, timeoutMs: ocrTimeoutMs,
      });
      state.ocrRecords.push({
        caseId: item.id, fileName: item.fileName, success: true,
        latencyMs: Date.now() - started, result, metrics: evaluateOcr(item, result), finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      state.ocrRecords.push({
        caseId: item.id, fileName: item.fileName, success: false,
        latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString(),
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
  const cases = loadCases();
  const state = loadOrCreateState(cases);
  writeArtifacts(state);
  if (phase === 'ocr' || phase === 'all') await runOcr(state);
  if (phase === 'agent' || phase === 'all') await runAgent(state);
  if (phase === 'all' && !state.finishedPhases.includes('all')) state.finishedPhases.push('all');
  writeArtifacts(state);
  console.log(`真实数据评测完成或已保存：${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
