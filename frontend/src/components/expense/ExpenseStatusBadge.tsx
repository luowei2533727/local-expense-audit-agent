import { Badge } from '../ui/Badge';
import { ExpenseStatus } from '../../types';
import { Clock, CheckCircle, XCircle, Eye } from 'lucide-react';

interface Props {
  status: ExpenseStatus;
}

export function ExpenseStatusBadge({ status }: Props) {
  const config = {
    PENDING: { variant: 'warning' as const, icon: Clock, label: '待审批' },
    APPROVED: { variant: 'success' as const, icon: CheckCircle, label: '已通过' },
    REJECTED: { variant: 'danger' as const, icon: XCircle, label: '已驳回' },
    UNDER_REVIEW: { variant: 'review' as const, icon: Eye, label: '复核中' },
  }[status];

  return (
    <Badge variant={config.variant} className="gap-1">
      <config.icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
