const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理员',
  MANAGER: '经理',
  EMPLOYEE: '员工',
};

const CATEGORY_LABELS: Record<string, string> = {
  Travel: '差旅交通',
  Meals: '餐饮',
  Accommodation: '住宿',
  'Office Supplies': '办公用品',
  Software: '软件订阅',
  Equipment: '设备',
  Marketing: '市场营销',
  Training: '培训',
  Other: '其他',
};

const RULE_TYPE_LABELS: Record<string, string> = {
  SEQUENTIAL: '顺序审批',
  PERCENTAGE: '比例审批',
  SPECIFIC: '指定审批人',
  HYBRID: '混合审批',
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  APPROVE: '建议通过',
  REVIEW: '建议复核',
  REJECT: '建议驳回',
};

const RISK_LABELS: Record<string, string> = {
  LOW: '低风险',
  MEDIUM: '中风险',
  HIGH: '高风险',
};

export const roleLabel = (value?: string | null) => value ? ROLE_LABELS[value] || value : '—';
export const categoryLabel = (value?: string | null) => value ? CATEGORY_LABELS[value] || value : '—';
export const ruleTypeLabel = (value?: string | null) => value ? RULE_TYPE_LABELS[value] || value : '—';
export const recommendationLabel = (value?: string | null) => value ? RECOMMENDATION_LABELS[value] || value : '—';
export const riskLabel = (value?: string | null) => value ? RISK_LABELS[value] || value : '—';
