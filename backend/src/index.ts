import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRoutes } from './routes/auth.routes';
import { expenseRoutes } from './routes/expense.routes';
import { approvalRoutes } from './routes/approval.routes';
import { userRoutes } from './routes/user.routes';
import { currencyRoutes } from './routes/currency.routes';
import { agentRoutes } from './routes/agent.routes';

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// CORS configuration
const allowedOrigins = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server / curl
    const allowed = allowedOrigins.includes(origin);
    callback(null, allowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
// A 10 MB binary receipt expands to roughly 13.3 MB as Base64 JSON.
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Health check
app.get('/health', async (_req, res) => {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  let models: string[] = [];
  let ollamaOnline = false;
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      ollamaOnline = true;
      const payload = await response.json() as { models?: Array<{ name?: string }> };
      models = payload.models?.flatMap((item) => item.name ? [item.name] : []) || [];
    }
  } catch { /* reported as offline below */ }
  res.json({
    success: true,
    data: {
      status: 'ok',
      app: 'ExpensePilot · 本地报销审核 Agent',
      localOnly: HOST === '127.0.0.1',
      ollama: { online: ollamaOnline, models },
      configuredModels: (process.env.OLLAMA_COMPARE_MODELS || 'qwen3.5:4b,qwen3:4b-instruct,phi4-mini:3.8b').split(','),
      pi: { framework: '@earendil-works/pi-agent-core', version: '0.84.2', toolPolicy: '工具白名单 + 调用次数限制 + 人工审批边界' },
      timestamp: new Date().toISOString(),
    },
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/users', userRoutes);
app.use('/api/currencies', currencyRoutes);
app.use('/api/agent', agentRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: '找不到该接口' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

app.listen(Number(PORT), HOST, () => {
  console.log(`ExpensePilot · 本地报销审核 Agent API：http://${HOST}:${PORT}`);
});

export default app;
