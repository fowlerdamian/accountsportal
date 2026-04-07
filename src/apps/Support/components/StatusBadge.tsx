import { cn } from '@/lib/utils';
import { CaseStatus, CaseType, ErrorOrigin, CasePriority, CASE_TYPE_LABELS, STATUS_LABELS } from '@/lib/types';

type StatusColor = 'urgent' | 'warning' | 'progress' | 'resolved' | 'neutral';

function getStatusColor(status: CaseStatus): StatusColor {
  switch (status) {
    case 'open': return 'neutral';
    case 'actioned': return 'progress';
    case 'in_hand': return 'warning';
    case 'closed': return 'resolved';
  }
}

function getCaseTypeColor(type: CaseType): StatusColor {
  switch (type) {
    case 'warranty_claim': return 'urgent';
    case 'order_error': return 'warning';
    case 'freight_issue': return 'progress';
    case 'complaint': return 'progress';
    case 'general': return 'neutral';
  }
}

const colorClasses: Record<StatusColor, string> = {
  urgent: 'bg-status-urgent/15 text-status-urgent border-status-urgent/30',
  warning: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  progress: 'bg-status-progress/15 text-status-progress border-status-progress/30',
  resolved: 'bg-status-resolved/15 text-status-resolved border-status-resolved/30',
  neutral: 'bg-status-neutral/15 text-status-neutral border-status-neutral/30',
};

export function CaseTypeBadge({ type }: { type: CaseType }) {
  const color = getCaseTypeColor(type);
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-medium border', colorClasses[color])}>
      {CASE_TYPE_LABELS[type]}
    </span>
  );
}

export function ErrorOriginBadge({ origin }: { origin: ErrorOrigin }) {
  if (!origin) return null;
  const labels: Record<string, string> = {
    order_entry: 'Order entry error',
    warehouse: 'Warehouse error',
  };
  const colors: Record<string, StatusColor> = {
    order_entry: 'warning',
    warehouse: 'progress',
  };
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-medium border', colorClasses[colors[origin] || 'neutral'])}>
      {labels[origin] || origin}
    </span>
  );
}

export function CaseOriginBadge({ type, origin }: { type: CaseType; origin: ErrorOrigin }) {
  if (type !== 'order_error') {
    return <CaseTypeBadge type={type} />;
  }
  if (origin) {
    const labels: Record<string, string> = {
      order_entry: 'Order entry error',
      warehouse: 'Warehouse error',
    };
    const colors: Record<string, StatusColor> = {
      order_entry: 'warning',
      warehouse: 'progress',
    };
    return (
      <span className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-medium border', colorClasses[colors[origin] || 'warning'])}>
        {labels[origin] || 'Order error'}
      </span>
    );
  }
  return <CaseTypeBadge type={type} />;
}

export function PriorityBadge({ priority }: { priority: CasePriority }) {
  if (priority !== 'urgent') return null;
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-medium border', colorClasses.urgent)}>
      Urgent
    </span>
  );
}

export function StatusLabel({ status }: { status: CaseStatus }) {
  const color = getStatusColor(status);
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-medium border', colorClasses[color])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function getLeftBorderColor(c: { type: CaseType; priority: CasePriority; status: CaseStatus }): string {
  if (c.priority === 'urgent') return 'hsl(4, 63%, 46%)';
  if (c.status === 'closed') return 'hsl(122, 46%, 33%)';
  if (c.status === 'in_hand') return 'hsl(267, 43%, 44%)';
  if (c.type === 'warranty_claim') return 'hsl(4, 63%, 46%)';
  if (c.type === 'order_error') return 'hsl(36, 88%, 43%)';
  if (c.type === 'freight_issue') return 'hsl(207, 73%, 38%)';
  if (c.type === 'complaint') return 'hsl(207, 73%, 38%)';
  return 'hsl(0, 0%, 35%)';
}
