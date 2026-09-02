import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_URL = 'https://download.openmmlab.com/mmocr/data/wildreceipt.tar';
const EXPECTED_SHA256 = 'f47646e16033d95c85a0b3a180a39d90cc354a729e51a280211b2fe7cae532bd';
const datasetRoot = resolve(process.cwd(), 'benchmarks', 'datasets', 'wildreceipt');
const archivePath = resolve(datasetRoot, 'wildreceipt.tar');
const partialPath = `${archivePath}.part`;
const extractedRoot = resolve(datasetRoot, 'wildreceipt');
const force = process.argv.includes('--force');

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function download(): Promise<void> {
  console.log(`下载 WildReceipt：${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partialPath));
  renameSync(partialPath, archivePath);
}

async function main(): Promise<void> {
  mkdirSync(datasetRoot, { recursive: true });
  if (force && existsSync(archivePath)) rmSync(archivePath);
  if (!existsSync(archivePath)) await download();

  const actualHash = await sha256(archivePath);
  if (actualHash !== EXPECTED_SHA256) {
    throw new Error(`数据集校验失败：期望 ${EXPECTED_SHA256}，实际 ${actualHash}`);
  }

  const required = ['train.txt', 'test.txt', 'class_list.txt'].map((name) => resolve(extractedRoot, name));
  if (force || required.some((file) => !existsSync(file))) {
    const result = spawnSync('tar', ['-xf', archivePath, '-C', datasetRoot], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('解压 WildReceipt 失败，请确认系统 tar 命令可用');
  }
  if (required.some((file) => !existsSync(file))) throw new Error('数据集结构校验失败');
  console.log(`WildReceipt 已就绪：${extractedRoot}`);
  console.log(`SHA-256：${actualHash}`);
}

main().catch((error) => {
  if (existsSync(partialPath)) rmSync(partialPath);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
