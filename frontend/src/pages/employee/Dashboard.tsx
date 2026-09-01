import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ExpenseTable } from '../../components/expense/ExpenseTable';
import { Skeleton } from '../../components/ui/Skeleton';
import { useMyExpenses } from '../../hooks/useExpenses';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, getMonthRange } from '../../lib/utils';
import { PlusCircle, TrendingUp, Clock, CheckCircle, XCircle } from 'lucide-react';
import { Expense } from '../../types';

export function EmployeeDashboard() {
  const { user } = useAuthStore();
  const { data: expenses = [], isLoading } = useMyExpenses();

  const { start, end } = getMonthRange();

  const stats = useMemo(() => {
    const thisMonth = expenses.filter((e: Expense) => {
      const d = new Date(e.created_at);
      return d >= start && d <= end;
    });

    return {
      total: thisMonth.length,
      totalAmount: thisMonth.reduce((sum, e) => sum + (e.converted_amount ?? e.amount), 0),
      pending: thisMonth.filter((e) => e.status === 'PENDING' || e.status === 'UNDER_REVIEW').length,
      approved: thisMonth.filter((e) => e.status === 'APPROVED').length,
      rejected: thisMonth.filter((e) => e.status === 'REJECTED').length,
    };
  }, [expenses, start, end]);

  const recentExpenses = expenses.slice(0, 5);
  const baseCurrency = user?.currency_code || 'USD';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">工作台</h1>
          <p className="text-text-secondary text-sm">{new Date().toLocaleString('zh-CN', { month: 'long', year: 'numeric' })}</p>
        </div>
        <Link to="/employee/submit">
          <Button size="md">
            <PlusCircle className="h-4 w-4" />
            提交报销
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded" />)
        ) : (
          <>
            {/* Primary stat card */}
            <Card className="bg-primary-700 border-0 text-text-inverse">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-primary-300 text-xs font-medium tracking-wide">本月报销总额</p>
                  <TrendingUp className="h-4 w-4 text-accent-400" />
                </div>
                <p className="text-2xl font-mono font-medium tabular-nums">{formatCurrency(stats.totalAmount, baseCurrency)}</p>
                <p className="text-primary-400 text-xs mt-1 tabular-nums">共 {stats.total} 笔</p>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-warning border-t-border border-r-border border-b-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-text-muted text-xs font-medium tracking-wide">待审批</p>
                  <Clock className="h-4 w-4 text-warning" />
                </div>
                <p className="text-2xl font-mono font-medium text-text-primary tabular-nums">{stats.pending}</p>
                <p className="text-text-muted text-xs mt-1">等待审批</p>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-success border-t-border border-r-border border-b-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-text-muted text-xs font-medium tracking-wide">已通过</p>
                  <CheckCircle className="h-4 w-4 text-success" />
                </div>
                <p className="text-2xl font-mono font-medium text-text-primary tabular-nums">{stats.approved}</p>
                <p className="text-text-muted text-xs mt-1">本月</p>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-danger border-t-border border-r-border border-b-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-text-muted text-xs font-medium tracking-wide">已驳回</p>
                  <XCircle className="h-4 w-4 text-danger" />
                </div>
                <p className="text-2xl font-mono font-medium text-text-primary tabular-nums">{stats.rejected}</p>
                <p className="text-text-muted text-xs mt-1">本月</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Recent Expenses */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>最近报销</CardTitle>
            <Link to="/employee/expenses">
              <Button variant="ghost" size="sm" className="text-accent hover:text-accent-600 hover:bg-accent-50">
                查看全部
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <ExpenseTable expenses={recentExpenses} loading={isLoading} />
        </CardContent>
      </Card>

      {/* FAB */}
      <Link
        to="/employee/submit"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary-700 text-text-inverse shadow-lg shadow-black/20 flex items-center justify-center hover:bg-primary-800 transition-colors lg:hidden"
      >
        <PlusCircle className="h-6 w-6" />
      </Link>
    </div>
  );
}
