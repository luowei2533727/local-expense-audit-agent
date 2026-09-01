import { Expense } from '../../types';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import { ExpenseStatusBadge } from './ExpenseStatusBadge';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';
import { categoryLabel } from '../../lib/i18n';

interface Props {
  expenses: Expense[];
  loading?: boolean;
  showEmployee?: boolean;
  onRowClick?: (expense: Expense) => void;
}

export function ExpenseTable({ expenses, loading, showEmployee, onRowClick }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mb-4">
          <span className="text-3xl">📄</span>
        </div>
        <p className="text-gray-500 font-medium">暂无报销记录</p>
        <p className="text-gray-400 text-sm mt-1">提交第一笔报销后即可在这里查看</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showEmployee && <TableHead>员工</TableHead>}
          <TableHead>日期</TableHead>
          <TableHead>商户</TableHead>
          <TableHead>类别</TableHead>
          <TableHead>金额</TableHead>
          <TableHead>状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {expenses.map((expense) => (
          <TableRow
            key={expense.id}
            className={onRowClick ? 'cursor-pointer' : ''}
            onClick={() => onRowClick?.(expense)}
          >
            {showEmployee && (
              <TableCell className="text-gray-500 text-xs">{expense.employee?.email}</TableCell>
            )}
            <TableCell className="text-gray-500">{formatDate(expense.expense_date)}</TableCell>
            <TableCell className="font-medium">{expense.merchant_name || '—'}</TableCell>
            <TableCell>
              <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary font-medium">
                {categoryLabel(expense.category)}
              </span>
            </TableCell>
            <TableCell className="font-semibold">
              {formatCurrency(expense.amount, expense.currency)}
              {expense.converted_amount && expense.base_currency && expense.base_currency !== expense.currency && (
                <span className="block text-xs text-gray-400 font-normal">
                  ≈ {formatCurrency(expense.converted_amount, expense.base_currency)}
                </span>
              )}
            </TableCell>
            <TableCell>
              <ExpenseStatusBadge status={expense.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
