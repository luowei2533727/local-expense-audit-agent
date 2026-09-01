import { useState } from 'react';
import { Expense } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';
import { formatCurrency, formatDate } from '../../lib/utils';
import { categoryLabel } from '../../lib/i18n';
import { useApproveExpense, useRejectExpense } from '../../hooks/useExpenses';
import { useToast } from '../ui/Toast';
import { ChevronDown, ChevronUp, User, Calendar, Tag, Building } from 'lucide-react';

interface Props {
  expense: Expense;
}

export function ApprovalCard({ expense }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [commentError, setCommentError] = useState('');

  const { toast } = useToast();
  const approveMutation = useApproveExpense();
  const rejectMutation = useRejectExpense();

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync({ id: expense.id, comment: comment || undefined });
      toast('报销已通过', 'success');
      setAction(null);
      setComment('');
    } catch {
      toast('审批失败，请稍后重试', 'error');
    }
  };

  const handleReject = async () => {
    if (comment.trim().length < 5) {
      setCommentError('驳回原因至少需要 5 个字符');
      return;
    }
    setCommentError('');
    try {
      await rejectMutation.mutateAsync({ id: expense.id, comment });
      toast('报销已驳回', 'warning');
      setAction(null);
      setComment('');
    } catch {
      toast('驳回失败，请稍后重试', 'error');
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {expense.merchant_name || expense.description}
            </CardTitle>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {expense.employee?.email}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(expense.expense_date)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-lg font-bold text-text-primary">
                {formatCurrency(expense.amount, expense.currency)}
              </p>
              {expense.converted_amount && expense.base_currency && expense.base_currency !== expense.currency && (
                <p className="text-xs text-gray-400">
                  ≈ {formatCurrency(expense.converted_amount, expense.base_currency)}
                </p>
              )}
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-surface hover:text-gray-600 transition-colors"
            >
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-4 bg-surface rounded-lg p-3">
            <div>
              <p className="text-xs text-gray-400 tracking-wide">类别</p>
              <div className="flex items-center gap-1 mt-1">
                <Tag className="h-3.5 w-3.5 text-primary" />
                <Badge variant="default">{categoryLabel(expense.category)}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 tracking-wide">商户</p>
              <p className="text-sm font-medium mt-1 flex items-center gap-1">
                <Building className="h-3.5 w-3.5 text-gray-400" />
                {expense.merchant_name || '—'}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 tracking-wide mb-1">报销说明</p>
            <p className="text-sm text-text-primary bg-surface rounded-lg p-3">{expense.description}</p>
          </div>

          {/* Action buttons */}
          {!action && (
            <div className="flex gap-2 pt-2">
              <Button
                variant="success"
                size="sm"
                className="flex-1"
                onClick={() => setAction('approve')}
              >
                通过
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                onClick={() => setAction('reject')}
              >
                驳回
              </Button>
            </div>
          )}

          {action === 'approve' && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <Textarea
                label="审批意见（可选）"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="填写审批意见…"
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  variant="success"
                  size="sm"
                  className="flex-1"
                  onClick={handleApprove}
                  loading={approveMutation.isPending}
                >
                  确认通过
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setAction(null); setComment(''); }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}

          {action === 'reject' && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <Textarea
                label="驳回原因"
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  if (e.target.value.trim().length >= 5) setCommentError('');
                }}
                placeholder="请填写驳回原因（必填）…"
                error={commentError}
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  onClick={handleReject}
                  loading={rejectMutation.isPending}
                >
                  确认驳回
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setAction(null); setComment(''); setCommentError(''); }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
