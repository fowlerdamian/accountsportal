import { CaseStatus, STATUS_LABELS } from '@/lib/types';

const ALL_STAGES: CaseStatus[] = ['open', 'actioned', 'in_hand', 'closed'];

const STAGE_COLORS: Record<CaseStatus, string> = {
  open: '#5A5A5A',
  actioned: '#1A6FA8',
  in_hand: '#6B3FA0',
  closed: '#2E7D32',
};

interface ProgressBarProps {
  status: CaseStatus;
  color?: string;
}

export function ProgressBar({ status }: ProgressBarProps) {
  const currentIndex = ALL_STAGES.indexOf(status);

  return (
    <div className="flex w-full" style={{ borderRadius: '2px', overflow: 'hidden' }}>
      {ALL_STAGES.map((stage, i) => {
        const isCurrent = stage === status;
        const isCompleted = i < currentIndex;
        const color = STAGE_COLORS[stage];

        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        let bgColor: string;
        let textColor: string;

        if (isCurrent) {
          bgColor = color;
          textColor = '#FFFFFF';
        } else if (isCompleted) {
          bgColor = `rgba(${r},${g},${b},0.25)`;
          textColor = color;
        } else {
          bgColor = '#161616';
          textColor = '#404040';
        }

        return (
          <div
            key={stage}
            className="flex-1 flex items-center justify-center"
            style={{
              backgroundColor: bgColor,
              height: 24,
              borderTop: isCurrent ? '2px solid rgba(255,255,255,0.8)' : '2px solid transparent',
            }}
          >
            <span
              className="text-[10px] font-heading font-bold uppercase tracking-[0.06em]"
              style={{ color: textColor }}
            >
              {STATUS_LABELS[stage].toUpperCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}