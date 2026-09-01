export interface WildReceiptAnnotation {
  box: number[];
  text: string;
  label: number;
}

export interface SelectedTotal {
  total: number;
  candidates: number[];
  method: 'single-value' | 'nearest-total-key' | 'first-labeled-value';
}

export function parseReceiptMoney(text: string): number | null {
  const compact = text.normalize('NFKC').replace(/\s/g, '');
  const matches = compact.match(/[-+]?\d[\d.,]*/g);
  if (!matches?.length) return null;
  const raw = matches[matches.length - 1].replace(/[^\d.,+-]/g, '');
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let normalized = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = raw.length - lastComma - 1;
    normalized = decimals === 2 ? raw.replace(',', '.') : raw.replace(/,/g, '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function center(annotation: WildReceiptAnnotation): { x: number; y: number } {
  const xs = [annotation.box[0], annotation.box[2], annotation.box[4], annotation.box[6]].filter(Number.isFinite);
  const ys = [annotation.box[1], annotation.box[3], annotation.box[5], annotation.box[7]].filter(Number.isFinite);
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / Math.max(xs.length, 1),
    y: ys.reduce((sum, value) => sum + value, 0) / Math.max(ys.length, 1),
  };
}

export function selectTotalAnnotation(
  annotations: WildReceiptAnnotation[],
  width: number,
  height: number,
): SelectedTotal | null {
  const values = annotations.flatMap((annotation) => {
    if (annotation.label !== 23) return [];
    const total = parseReceiptMoney(annotation.text);
    return total != null && total > 0 ? [{ annotation, total }] : [];
  });
  if (!values.length) return null;
  const candidates = values.map((item) => item.total);
  if (values.length === 1) return { total: values[0].total, candidates, method: 'single-value' };

  const labeledKeys = annotations.filter((annotation) => annotation.label === 24);
  const textualKeys = annotations.filter((annotation) => {
    const text = annotation.text.normalize('NFKC').toLowerCase().replace(/[^a-z]/g, '');
    return /^(grandtotal|total|amountdue|amt)$/.test(text);
  });
  const keys = labeledKeys.length ? labeledKeys : textualKeys;
  if (keys.length) {
    const scored = values.map((current) => {
      const valueCenter = center(current.annotation);
      const score = Math.min(...keys.map((key) => {
        const keyCenter = center(key);
        const vertical = Math.abs(valueCenter.y - keyCenter.y) / Math.max(height, 1);
        const horizontal = Math.abs(valueCenter.x - keyCenter.x) / Math.max(width, 1);
        const leftPenalty = valueCenter.x < keyCenter.x ? 0.25 : 0;
        return vertical * 5 + horizontal + leftPenalty;
      }));
      return { ...current, score };
    });
    const selected = scored.reduce((best, current) => current.score < best.score ? current : best);
    return { total: selected.total, candidates, method: 'nearest-total-key' };
  }

  return { total: values[0].total, candidates, method: 'first-labeled-value' };
}
