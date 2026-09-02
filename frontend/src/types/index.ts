export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNDER_REVIEW';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type RuleType = 'SEQUENTIAL' | 'PERCENTAGE' | 'SPECIFIC' | 'HYBRID';

export interface User {
  id: string;
  email: string;
  role: Role;
  company_id: string;
  company_name?: string;
  currency_code?: string;
  manager_id?: string | null;
  is_manager_approver?: boolean;
  created_at?: string;
  manager?: { id: string; email: string } | null;
}

export interface Company {
  id: string;
  name: string;
  currency_code: string;
  country: string;
  created_at: string;
}

export interface Expense {
  id: string;
  employee_id: string;
  amount: number;
  currency: string;
  converted_amount?: number | null;
  base_currency?: string | null;
  category: string;
  description: string;
  expense_date: string;
  status: ExpenseStatus;
  receipt_url?: string | null;
  merchant_name?: string | null;
  created_at: string;
  employee?: Pick<User, 'id' | 'email' | 'role'>;
  approval_requests?: ApprovalRequest[];
}

export interface ApprovalRequest {
  id: string;
  expense_id: string;
  step_id: string;
  approver_id: string;
  status: ApprovalStatus;
  comment?: string | null;
  decided_at?: string | null;
  created_at: string;
  approver?: Pick<User, 'id' | 'email'>;
}

export interface ApprovalStep {
  id: string;
  policy_id: string;
  step_order: number;
  approver_role?: Role | null;
  approver_user_id?: string | null;
  specific_approver?: Pick<User, 'id' | 'email'> | null;
}

export interface ApprovalPolicy {
  id: string;
  company_id: string;
  name: string;
  rule_type: RuleType;
  percentage_threshold?: number | null;
  specific_approver_id?: string | null;
  steps: ApprovalStep[];
  specific_approver?: Pick<User, 'id' | 'email'> | null;
}

export interface AuditLog {
  id: string;
  expense_id: string;
  actor_id: string;
  action: string;
  metadata: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
  actor: Pick<User, 'id' | 'email' | 'role'>;
}

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  timestamp: string;
}

export interface OCRResult {
  receipt_asset_id: string;
  amount: number | null;
  currency: string | null;
  date: string | null;
  merchant_name: string | null;
  invoice_code: string | null;
  invoice_number: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  tax_amount: number | null;
  category: string | null;
  description: string | null;
  confidence: {
    amount: 'high' | 'low';
    currency: 'high' | 'low';
    date: 'high' | 'low';
    merchant_name: 'high' | 'low';
    invoice_code: 'high' | 'low';
    invoice_number: 'high' | 'low';
    buyer_name: 'high' | 'low';
    seller_name: 'high' | 'low';
    tax_amount: 'high' | 'low';
    category: 'high' | 'low';
    description: 'high' | 'low';
  };
  raw_text: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AuthState {
  user: User | null;
  access_token: string | null;
  refresh_token: string | null;
  isAuthenticated: boolean;
}

export interface AgentModelInfo {
  name: string;
  installed: boolean;
  sizeBytes: number | null;
}

export interface AgentModelStatus {
  online: boolean;
  baseUrl?: string;
  defaultModel?: string;
  configured: AgentModelInfo[];
}

export interface AgentMetrics {
  latencyMs: number;
  firstTokenMs: number | null;
  inputTokens: number;
  outputTokens: number;
  tokensPerSecond: number;
  ollamaEvalDurationMs: number;
  ollamaLoadDurationMs: number;
  agentTurns: number;
  toolCalls: number;
  repairAttempts: number;
  sizeBytes: number | null;
  vramBytes: number | null;
}

export interface AgentCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface AgentComparisonResult {
  success: boolean;
  model: string;
  error?: string;
  recommendation?: 'APPROVE' | 'REVIEW' | 'REJECT';
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH';
  summary?: string;
  checks?: AgentCheck[];
  missing_documents?: string[];
  confidence?: number;
  human_review_required?: boolean;
  metrics?: AgentMetrics;
  traceId?: string;
}

export interface AgentComparison {
  expense: { id: string; merchantName: string | null; amount: number; currency: string };
  comparedAt: string;
  fairRun: string;
  humanReviewRequired: boolean;
  results: AgentComparisonResult[];
}

export const EXPENSE_CATEGORIES = [
  'Travel',
  'Meals',
  'Accommodation',
  'Office Supplies',
  'Software',
  'Equipment',
  'Marketing',
  'Training',
  'Other',
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN',
  'BRL', 'KRW', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'HKD', 'ZAR', 'AED',
] as const;
