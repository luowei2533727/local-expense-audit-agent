import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin, requireManager, requireEmployee } from '../middleware/role.middleware';
import {
  submitExpense,
  getMyExpenses,
  getPendingExpenses,
  getAllExpenses,
  approveExpense,
  rejectExpense,
  ocrReceipt,
  getExpenseAudit,
  getExpenseReceipt,
} from '../controllers/expense.controller';

const router = Router();
const inferenceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, error: '本地模型请求过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authenticate);

router.post('/', requireEmployee, submitExpense);
router.get('/me', requireEmployee, getMyExpenses);
router.get('/pending', requireManager, getPendingExpenses);
router.get('/', requireAdmin, getAllExpenses);
router.patch('/:id/approve', requireManager, approveExpense);
router.patch('/:id/reject', requireManager, rejectExpense);
router.post('/ocr', requireEmployee, inferenceLimiter, ocrReceipt);
router.get('/:id/receipt', requireEmployee, getExpenseReceipt);
router.get('/:id/audit', requireAdmin, getExpenseAudit);

export { router as expenseRoutes };
