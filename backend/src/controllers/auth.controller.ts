import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getCurrencyFromCountry } from '../services/currency.service';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const signupSchema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少需要 8 个字符'),
  company_name: z.string().min(2, '企业名称至少需要 2 个字符'),
  country: z.string().min(2, '请选择国家或地区'),
});

const loginSchema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string(),
});

function generateAccessToken(payload: { id: string; email: string; role: string; company_id: string }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign(payload, secret, { expiresIn: '15m' });
}

function generateRefreshToken(payload: { id: string }) {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  if (!secret) throw new Error('REFRESH_TOKEN_SECRET not configured');
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { email, password, company_name, country } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: '该邮箱已被使用' });
      return;
    }

    const currency_code = await getCurrencyFromCountry(country);
    const company = await prisma.company.create({
      data: { name: company_name, currency_code, country },
    });

    const password_hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        company_id: company.id,
        role: 'ADMIN',
      },
    });

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      company_id: user.company_id,
    });
    const refreshToken = generateRefreshToken({ id: user.id });

    await prisma.user.update({
      where: { id: user.id },
      data: { refresh_token: refreshToken },
    });

    res.status(201).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          company_id: user.company_id,
          company_name: company.name,
          currency_code: company.currency_code,
        },
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, error: '创建账号失败' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!user) {
      res.status(401).json({ success: false, error: '邮箱或密码错误' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ success: false, error: '邮箱或密码错误' });
      return;
    }

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      company_id: user.company_id,
    });
    const refreshToken = generateRefreshToken({ id: user.id });

    await prisma.user.update({
      where: { id: user.id },
      data: { refresh_token: refreshToken },
    });

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          company_id: user.company_id,
          company_name: user.company.name,
          currency_code: user.company.currency_code,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: '登录失败' });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      res.status(400).json({ success: false, error: '缺少刷新令牌' });
      return;
    }

    const secret = process.env.REFRESH_TOKEN_SECRET;
    if (!secret) {
      res.status(500).json({ success: false, error: '服务器配置错误' });
      return;
    }

    const decoded = jwt.verify(refresh_token, secret) as { id: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { company: true },
    });

    if (!user || user.refresh_token !== refresh_token) {
      res.status(401).json({ success: false, error: '刷新令牌无效' });
      return;
    }

    const newAccessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      company_id: user.company_id,
    });
    const newRefreshToken = generateRefreshToken({ id: user.id });

    await prisma.user.update({
      where: { id: user.id },
      data: { refresh_token: newRefreshToken },
    });

    res.json({
      success: true,
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      },
    });
  } catch {
    res.status(401).json({ success: false, error: '刷新令牌无效' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await prisma.user.updateMany({
        where: { refresh_token },
        data: { refresh_token: null },
      });
    }
    res.json({ success: true, data: { message: '已退出登录' } });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, error: '退出登录失败' });
  }
};
