import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export type PaddleVatSplit = 'train' | 'val';

export interface PaddleVatToken {
  transcription: string;
  label: 'question' | 'answer' | 'other' | string;
  points: number[][];
  id?: number;
  linking?: number[][];
}

export interface PaddleVatPair {
  question: string;
  answer: string;
}

export interface PaddleVatCase {
  id: string;
  split: PaddleVatSplit;
  fileName: string;
  imagePath: string;
  rawText: string;
  pairs: PaddleVatPair[];
  invoiceCode: string | null;
  invoiceNumber: string | null;
  date: string | null;
  buyerName: string | null;
  sellerName: string | null;
  amount: number | null;
  taxAmount: number | null;
}

interface ParsedAnnotationLine {
  fileName: string;
  tokens: PaddleVatToken[];
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s:：()（）【】\[\]_-]+/g, '');
}

function normalizeValue(value: string): string {
  return value.normalize('NFKC').trim();
}

function parseAnnotationLine(line: string): ParsedAnnotationLine {
  const trimmed = line.trim();
  const tabIndex = trimmed.indexOf('\t');
  const jsonIndex = trimmed.indexOf('[');
  const separator = tabIndex >= 0 && tabIndex < jsonIndex ? tabIndex : jsonIndex;
  if (separator <= 0 || jsonIndex < 0) throw new Error(`无法解析 PaddleOCR 标注行：${trimmed.slice(0, 80)}`);
  const fileName = trimmed.slice(0, separator).trim();
  const tokens = JSON.parse(trimmed.slice(jsonIndex)) as PaddleVatToken[];
  if (!fileName || !Array.isArray(tokens)) throw new Error('PaddleOCR 标注行缺少文件名或文本框数组');
  return { fileName, tokens };
}

function readingOrder(tokens: PaddleVatToken[]): PaddleVatToken[] {
  return [...tokens].sort((left, right) => {
    const leftY = Math.min(...left.points.map((point) => point[1] ?? 0));
    const rightY = Math.min(...right.points.map((point) => point[1] ?? 0));
    if (Math.abs(leftY - rightY) > 12) return leftY - rightY;
    const leftX = Math.min(...left.points.map((point) => point[0] ?? 0));
    const rightX = Math.min(...right.points.map((point) => point[0] ?? 0));
    return leftX - rightX;
  });
}

function linkedPairs(tokens: PaddleVatToken[]): PaddleVatPair[] {
  const byId = new Map(tokens.flatMap((token) => token.id == null ? [] : [[token.id, token] as const]));
  const seen = new Set<string>();
  const pairs: PaddleVatPair[] = [];
  for (const token of tokens) {
    for (const link of token.linking || []) {
      if (!Array.isArray(link) || link.length !== 2) continue;
      const key = [...link].sort((a, b) => a - b).join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const first = byId.get(link[0]);
      const second = byId.get(link[1]);
      if (!first || !second) continue;
      const question = first.label === 'question' ? first : second.label === 'question' ? second : null;
      const answer = first.label === 'answer' ? first : second.label === 'answer' ? second : null;
      if (question && answer) pairs.push({
        question: normalizeValue(question.transcription),
        answer: normalizeValue(answer.transcription),
      });
    }
  }
  return pairs;
}

function answerFor(pairs: PaddleVatPair[], predicate: (key: string) => boolean): string | null {
  const pair = pairs.find((item) => predicate(normalizeKey(item.question)));
  return pair?.answer || null;
}

export function parseVatMoney(value: string | null): number | null {
  if (!value) return null;
  const match = value.normalize('NFKC').replace(/[,，\s]/g, '').match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

export function parseVatDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize('NFKC');
  const match = normalized.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function buildPaddleVatCase(
  line: string,
  split: PaddleVatSplit,
  imagesRoot: string,
): PaddleVatCase {
  const parsed = parseAnnotationLine(line);
  const pairs = linkedPairs(parsed.tokens);
  const invoiceCode = answerFor(pairs, (key) => key.includes('发票代码') || key === 'invoicecode');
  const invoiceNumber = answerFor(pairs, (key) => key.includes('发票号码') || key.includes('发票号') || key === 'no');
  const dateText = answerFor(pairs, (key) => (key.startsWith('开') && key.endsWith('日期')) || key === 'date' || key === '日期');
  // This public dataset annotates the first VAT-invoice "名称" field, which is
  // located in the buyer section. It does not annotate the seller name.
  const buyerName = answerFor(pairs, (key) => key === '名称'
    || ((key.includes('购买方') || key.includes('买方')) && key.includes('名称')));
  const sellerName = answerFor(pairs, (key) => (key.includes('销售方') || key.includes('卖方')) && key.includes('名称'));
  const totalText = answerFor(pairs, (key) => key.includes('价税合计') && !key.includes('大写'))
    || answerFor(pairs, (key) => key === '总计' || key === '合计');
  // Several source annotations contain visually similar OCR labels such as
  // 税颜/税领/税颈. They all link to the tax-value box in the same schema.
  const taxText = answerFor(pairs, (key) => /^税[额颜领颈]$/.test(key) || key.includes('合计税额'));
  const rawText = readingOrder(parsed.tokens)
    .map((token) => normalizeValue(token.transcription)).filter(Boolean).join('\n');
  return {
    id: basename(parsed.fileName).replace(/\.[^.]+$/, ''),
    split,
    fileName: parsed.fileName,
    imagePath: resolve(imagesRoot, parsed.fileName),
    rawText,
    pairs,
    invoiceCode,
    invoiceNumber,
    date: parseVatDate(dateText),
    buyerName,
    sellerName,
    amount: parseVatMoney(totalText),
    taxAmount: parseVatMoney(taxText),
  };
}

export function loadPaddleVatCases(datasetRoot: string): PaddleVatCase[] {
  const imagesRoot = resolve(datasetRoot, 'imgs');
  const cases = (['train', 'val'] as const).flatMap((split) => {
    const annotationPath = resolve(datasetRoot, `${split}.json`);
    if (!existsSync(annotationPath)) throw new Error(`缺少 PaddleOCR 标注文件：${annotationPath}`);
    return readFileSync(annotationPath, 'utf8').split(/\r?\n/).filter((line) => line.trim())
      .map((line) => buildPaddleVatCase(line, split, imagesRoot));
  });
  const missingImages = cases.filter((item) => !existsSync(item.imagePath));
  if (missingImages.length) throw new Error(`PaddleOCR 数据集中有 ${missingImages.length} 张标注图片缺失`);
  return cases;
}
