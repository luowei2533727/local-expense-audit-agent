import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';

export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: '请先登录' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `权限不足，需要以下角色之一：${roles.join('、')}`,
      });
      return;
    }
    next();
  };
};

export const requireAdmin = requireRole('ADMIN');
export const requireManager = requireRole('ADMIN', 'MANAGER');
export const requireEmployee = requireRole('ADMIN', 'MANAGER', 'EMPLOYEE');
