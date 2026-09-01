import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Bot, CheckCircle2, Cpu, Gauge, HardDrive, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import { agentApi } from '../../lib/api';
import { useAllExpenses } from '../../hooks/useExpenses';
import { AgentComparison, AgentComparisonResult, AgentModelStatus } from '../../types';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { recommendationLabel, riskLabel } from '../../lib/i18n';

function bytes(value: number | null | undefined): string {
  if (!value) return '—';
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function recommendationVariant(value?: string) {
  if (value === 'APPROVE') return 'success' as const;
  if (value === 'REJECT') return 'danger' as const;
  return 'warning' as const;
}

function ResultCard({ result }: { result: AgentComparisonResult }) {
  if (!result.success) {
    return (
      <Card className="border-red-200">
        <CardHeader><CardTitle className="font-mono text-sm">{result.model}</CardTitle></CardHeader>
        <CardContent className="pt-5 text-sm text-danger">
          <div className="flex gap-2"><TriangleAlert className="h-4 w-4 shrink-0" />{result.error}</div>
        </CardContent>
      </Card>
    );
  }
  const failed = result.checks?.filter((check) => check.status === 'fail').length || 0;
  const warnings = result.checks?.filter((check) => check.status === 'warn').length || 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-mono text-sm">{result.model}</CardTitle>
          <Badge variant={recommendationVariant(result.recommendation)}>{recommendationLabel(result.recommendation)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <p className="text-sm leading-6 text-text-secondary">{result.summary}</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded bg-panel p-3"><span className="text-text-muted">风险等级</span><p className="mt-1 font-semibold">{riskLabel(result.risk_level)}</p></div>
          <div className="rounded bg-panel p-3"><span className="text-text-muted">置信度</span><p className="mt-1 font-semibold">{Math.round((result.confidence || 0) * 100)}%</p></div>
          <div className="rounded bg-panel p-3"><span className="text-text-muted">警告项</span><p className="mt-1 font-semibold">{warnings}</p></div>
          <div className="rounded bg-panel p-3"><span className="text-text-muted">失败项</span><p className="mt-1 font-semibold">{failed}</p></div>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <ShieldCheck className="h-4 w-4 text-success" /> 所有建议仍须人工审批
        </div>
      </CardContent>
    </Card>
  );
}

export function AgentLabPage() {
  const { data: expenses = [], isLoading: expensesLoading } = useAllExpenses();
  const [expenseId, setExpenseId] = useState('');
  const [modelStatus, setModelStatus] = useState<AgentModelStatus | null>(null);
  const [assessment, setAssessment] = useState<AgentComparisonResult | null>(null);
  const [comparison, setComparison] = useState<AgentComparison | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    agentApi.getModels()
      .then((response) => setModelStatus(response.data.data))
      .catch((reason) => {
        if (axios.isAxiosError(reason) && reason.response?.data?.data) setModelStatus(reason.response.data.data);
        setError(axios.isAxiosError(reason) ? reason.response?.data?.error || reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    if (!expenseId && expenses.length) {
      setExpenseId(expenses.find((expense) => expense.status === 'PENDING')?.id || expenses[0].id);
    }
  }, [expenseId, expenses]);

  const selected = useMemo(() => expenses.find((expense) => expense.id === expenseId), [expenseId, expenses]);
  const modelsReady = Boolean(
    modelStatus?.online && modelStatus.configured.length === 3 && modelStatus.configured.every((model) => model.installed),
  );
  const defaultModelReady = Boolean(
    modelStatus?.online
      && modelStatus.defaultModel
      && modelStatus.configured.find((model) => model.name === modelStatus.defaultModel)?.installed,
  );

  async function runDefaultAssessment() {
    if (!expenseId) return;
    setAssessing(true);
    setError('');
    setAssessment(null);
    try {
      const response = await agentApi.assess(expenseId);
      setAssessment(response.data.data);
    } catch (reason) {
      setError(axios.isAxiosError(reason) ? reason.response?.data?.error || reason.message : String(reason));
    } finally {
      setAssessing(false);
    }
  }

  async function runComparison() {
    if (!expenseId) return;
    setLoading(true);
    setError('');
    setComparison(null);
    try {
      const response = await agentApi.compare(expenseId);
      setComparison(response.data.data);
    } catch (reason) {
      setError(axios.isAxiosError(reason) ? reason.response?.data?.error || reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2"><Bot className="h-6 w-6 text-accent" /><h1 className="text-2xl font-bold text-text-primary">PI Agent 模型实验室</h1></div>
          <p className="mt-2 text-sm text-text-secondary">本地 Ollama · 三模型对比 · 只读审核辅助</p>
        </div>
        <Badge variant={modelStatus?.online ? 'success' : 'danger'}>{modelStatus?.online ? 'Ollama 在线' : 'Ollama 离线'}</Badge>
      </div>

      <div className="rounded border border-amber-200 bg-warning-surface px-4 py-3 text-sm text-warning flex gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <span>Agent 只能检查单笔报销并调用只读规则工具，不能通过、驳回、付款、发送邮件或改变数据库工作流状态。</span>
      </div>

      <Card>
        <CardHeader><CardTitle>对比设置</CardTitle></CardHeader>
        <CardContent className="pt-5 space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="block text-sm font-medium text-text-primary">
              报销单
              <select
                className="mt-2 h-10 w-full rounded border border-border bg-canvas px-3 text-sm outline-none focus:border-accent"
                value={expenseId}
                disabled={expensesLoading || loading || assessing}
                onChange={(event) => setExpenseId(event.target.value)}
              >
                {expenses.map((expense) => (
                  <option key={expense.id} value={expense.id}>
                    {expense.merchant_name || expense.description} · {formatCurrency(expense.amount, expense.currency)} · {formatDate(expense.expense_date)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <Button loading={assessing} disabled={!expenseId || !defaultModelReady || loading} onClick={runDefaultAssessment}>
                <ShieldCheck className="h-4 w-4" /> 默认模型审核
              </Button>
              <Button loading={loading} disabled={!expenseId || !modelsReady || assessing} onClick={runComparison}>
                <Zap className="h-4 w-4" /> 运行三模型对比
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {(modelStatus?.configured || []).map((model) => (
              <div key={model.name} className="flex items-center justify-between rounded bg-panel px-4 py-3">
                <div>
                  <p className="font-mono text-xs font-semibold">{model.name}{model.name === modelStatus?.defaultModel ? ' · 默认审核' : ''}</p>
                  <p className="mt-1 text-xs text-text-muted">磁盘占用 {bytes(model.sizeBytes)}</p>
                </div>
                {model.installed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <TriangleAlert className="h-4 w-4 text-warning" />}
              </div>
            ))}
          </div>
          {selected && <p className="text-xs text-text-muted">三个模型接收同一份不可变报销快照 {selected.id}，以温度 0 顺序运行。</p>}
        </CardContent>
      </Card>

      {error && <div className="rounded border border-red-200 bg-danger-surface p-4 text-sm text-danger">{error}</div>}

      {assessment && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">默认模型审核结果</h2>
          <div className="max-w-xl"><ResultCard result={assessment} /></div>
        </section>
      )}

      {comparison && (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            {comparison.results.map((result) => <ResultCard key={result.model} result={result} />)}
          </div>

          <Card>
            <CardHeader><CardTitle>工程指标</CardTitle></CardHeader>
            <CardContent className="p-0 pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-panel text-left text-xs text-text-muted">
                  <tr><th className="px-5 py-3">模型</th><th className="px-4 py-3">首 Token 延迟</th><th className="px-4 py-3">总耗时</th><th className="px-4 py-3">Token/秒</th><th className="px-4 py-3">输入/输出</th><th className="px-4 py-3">显存/内存</th><th className="px-4 py-3">轮次/工具/修复</th></tr>
                </thead>
                <tbody>
                  {comparison.results.map((result) => (
                    <tr key={result.model} className="border-b border-border last:border-0">
                      <td className="px-5 py-4 font-mono text-xs font-semibold">{result.model}</td>
                      {result.metrics ? <>
                        <td className="px-4 py-4"><Gauge className="mr-1 inline h-3.5 w-3.5" />{result.metrics.firstTokenMs ?? '—'} ms</td>
                        <td className="px-4 py-4">{(result.metrics.latencyMs / 1000).toFixed(2)} 秒</td>
                        <td className="px-4 py-4">{result.metrics.tokensPerSecond}</td>
                        <td className="px-4 py-4">{result.metrics.inputTokens} / {result.metrics.outputTokens}</td>
                        <td className="px-4 py-4"><HardDrive className="mr-1 inline h-3.5 w-3.5" />{bytes(result.metrics.vramBytes || result.metrics.sizeBytes)}</td>
                        <td className="px-4 py-4"><Cpu className="mr-1 inline h-3.5 w-3.5" />{result.metrics.agentTurns} / {result.metrics.toolCalls} / {result.metrics.repairAttempts}</td>
                      </> : <td className="px-4 py-4 text-danger" colSpan={6}>运行失败</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
