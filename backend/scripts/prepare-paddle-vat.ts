import 'dotenv/config';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadPaddleVatCases } from './lib/paddle-vat-adapter';

const datasetHome = resolve(process.cwd(), 'benchmarks', 'datasets', 'paddle-vat');
const archivePath = resolve(datasetHome, 'zzsfp.tar');

function argument(name: string): string | null {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function isDatasetRoot(directory: string): boolean {
  return ['train.json', 'val.json', 'class_list.txt', 'imgs']
    .every((name) => existsSync(resolve(directory, name)));
}

function findDatasetRoot(directory: string, depth = 0): string | null {
  if (isDatasetRoot(directory)) return directory;
  if (depth >= 3) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findDatasetRoot(resolve(directory, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

async function main(): Promise<void> {
  mkdirSync(datasetHome, { recursive: true });
  const suppliedArchive = argument('archive');
  if (suppliedArchive) {
    const source = resolve(suppliedArchive);
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`找不到标注包：${source}`);
    if (source !== archivePath) copyFileSync(source, archivePath);
  }
  if (!existsSync(archivePath)) {
    throw new Error(
      `缺少 ${archivePath}\n请从 https://aistudio.baidu.com/datasetdetail/165561 下载 zzsfp.tar，`
      + '然后使用 pnpm dataset:paddle-vat -- --archive=<下载文件路径>。',
    );
  }

  let root = findDatasetRoot(datasetHome);
  if (!root || process.argv.includes('--force')) {
    const result = spawnSync('tar', ['-xf', archivePath, '-C', datasetHome], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('解压 zzsfp.tar 失败，请确认系统 tar 命令可用');
    root = findDatasetRoot(datasetHome);
  }
  if (!root) throw new Error('zzsfp.tar 结构校验失败：未找到 imgs、train.json、val.json 和 class_list.txt');

  const cases = loadPaddleVatCases(root);
  const trainCount = cases.filter((item) => item.split === 'train').length;
  const valCount = cases.filter((item) => item.split === 'val').length;
  const uniqueCount = new Set(cases.map((item) => item.fileName)).size;
  if (trainCount !== 30 || valCount !== 8 || uniqueCount !== 38) {
    throw new Error(`样本数量与 PaddleOCR 文档不一致：train=${trainCount}，val=${valCount}，unique=${uniqueCount}`);
  }
  const digest = await sha256(archivePath);
  console.log(`PaddleOCR 增值税发票数据已就绪：${root}`);
  console.log(`标注样本：训练集 ${trainCount} 张，验证集 ${valCount} 张，共 ${uniqueCount} 张唯一图片`);
  console.log(`归档：${basename(archivePath)}，SHA-256：${digest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
