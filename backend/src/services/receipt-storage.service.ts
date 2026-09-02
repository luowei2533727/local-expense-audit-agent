import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../lib/prisma';

const RECEIPT_ROOT = resolve(process.cwd(), 'prisma', 'data', 'receipts');
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function hasExpectedSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function decodeImage(imageBase64: string, mimeType: string): Buffer {
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) throw new Error('不支持的票据图片格式');
  if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) throw new Error('票据图片 Base64 内容无效');
  const bytes = Buffer.from(imageBase64, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('票据图片必须小于 10MB');
  if (!hasExpectedSignature(bytes, mimeType)) throw new Error('票据图片内容与声明格式不一致');
  return bytes;
}

export function validateReceiptImage(imageBase64: string, mimeType: string): void {
  decodeImage(imageBase64, mimeType);
}

export async function createReceiptAsset(ownerId: string, imageBase64: string, mimeType: string): Promise<string> {
  const bytes = decodeImage(imageBase64, mimeType);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const existing = await prisma.receiptAsset.findFirst({
    where: { owner_id: ownerId, sha256: digest, expense_id: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  await mkdir(RECEIPT_ROOT, { recursive: true });
  const fileName = `${randomUUID()}.${MIME_EXTENSIONS[mimeType]}`;
  const filePath = resolve(RECEIPT_ROOT, fileName);
  await writeFile(filePath, bytes, { flag: 'wx' });
  try {
    const asset = await prisma.receiptAsset.create({
      data: { owner_id: ownerId, file_name: fileName, mime_type: mimeType, size_bytes: bytes.length, sha256: digest },
      select: { id: true },
    });
    return asset.id;
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

export async function readReceiptAsset(expenseId: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const asset = await prisma.receiptAsset.findUnique({
    where: { expense_id: expenseId },
    select: { file_name: true, mime_type: true },
  });
  if (!asset || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(asset.file_name)) return null;
  const filePath = resolve(RECEIPT_ROOT, asset.file_name);
  if (!filePath.startsWith(`${RECEIPT_ROOT}\\`) && !filePath.startsWith(`${RECEIPT_ROOT}/`)) return null;
  try {
    return { bytes: await readFile(filePath), mimeType: asset.mime_type };
  } catch {
    return null;
  }
}
