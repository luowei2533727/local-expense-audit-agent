import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/role.middleware';
import { assessExpense, compareModels, listAssessments, modelStatus } from '../controllers/agent.controller';

const router = Router();
const inferenceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, error: '本地 Agent 请求过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
});
const asyncRoute = (handler: (req: AuthenticatedRequest, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => { void handler(req as AuthenticatedRequest, res).catch(next); };

router.use(authenticate, requireAdmin);
router.get('/models', asyncRoute(modelStatus));
router.post('/assess/:expenseId', inferenceLimiter, asyncRoute(assessExpense));
router.post('/compare/:expenseId', inferenceLimiter, asyncRoute(compareModels));
router.get('/assessments/:expenseId', asyncRoute(listAssessments));

export { router as agentRoutes };
