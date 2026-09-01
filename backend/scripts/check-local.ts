import 'dotenv/config';
import {
  getConfiguredModels,
  getDefaultModel,
  getOllamaCapabilities,
  listOllamaModels,
} from '../src/services/pi-agent.service';

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Error(`Node.js 22.19+ is required by PI Agent 0.84.x; found ${process.version}`);

  const configured = getConfiguredModels();
  if (configured.length !== 3) throw new Error(`OLLAMA_COMPARE_MODELS must contain exactly three unique models; found ${configured.length}`);

  const installed = await listOllamaModels();
  const names = new Set(installed.map((model) => model.name));
  const missing = configured.filter((model) => !names.has(model));
  const defaultModel = getDefaultModel();
  const vision = process.env.OLLAMA_VISION_MODEL || 'qwen3.5:4b';

  console.log(`Node ${process.version}: OK`);
  console.log(`Ollama ${(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')}: OK`);
  console.log(`Comparison models: ${configured.join(', ')}`);
  if (missing.length) {
    throw new Error(`Missing comparison models:\n${missing.map((model) => `  ollama pull ${model}`).join('\n')}`);
  }
  if (!names.has(defaultModel)) throw new Error(`Default model is not installed: ${defaultModel}`);
  if (!names.has(vision)) throw new Error(`Vision model is not installed: ${vision}`);

  const visionCapabilities = await getOllamaCapabilities(vision);
  if (!visionCapabilities.includes('vision')) {
    throw new Error(`OLLAMA_VISION_MODEL must support image input; ${vision} capabilities: ${visionCapabilities.join(', ') || 'unknown'}`);
  }
  console.log(`Default audit model: ${defaultModel} (installed)`);
  console.log(`Vision model: ${vision} (installed; ${visionCapabilities.join(', ')})`);
  console.log('Local PI Agent prerequisites: OK');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
