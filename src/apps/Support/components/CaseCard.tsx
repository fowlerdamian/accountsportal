import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Case, STATUS_LABELS } from '@/lib/types';
import { CaseOriginBadge, PriorityBadge, StatusLabel, getLeftBorderColor } from './StatusBadge';
import { ProgressBar } from './ProgressBar';
import { ResponseTimer } from './ResponseTimer';
import { formatDistanceToNow } from 'date-fns';

interface CaseCardProps {
  caseData: Case;
  index: number;
}

export function CaseCard({ caseData, index }: CaseCardProps) {
  const navigate = useNavigate();
  const borderColor = getLeftBorderColor(caseData);
  const isClosed = caseData.status === 'closed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isClosed ? 0.6 : 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      onClick={() => navigate(`/support/cases/${caseData.id}`)}
      style={{
        background: '#0a0a0a',
        border: '1px solid #222228',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'border-color 150ms, transform 150ms, box-shadow 150ms',
        userSelect: 'none',
      }}
      whileHover={{
        borderColor: 'rgba(243,202,15,0.35)',
        y: -1,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ padding: '16px' }}>
        {/* Top row: badges + case number */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <CaseOriginBadge type={caseData.type} origin={caseData.error_origin} />
          <PriorityBadge priority={caseData.priority} />
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '11px',
              fontFamily: '"JetBrains Mono", monospace',
              color: '#f3ca0f',
            }}
          >
            #{caseData.case_number}
          </span>
        </div>

        {/* Title */}
        <p style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', margin: '0 0 4px' }}>
          {caseData.title}
        </p>

        {/* Order + time — mono label style */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            color: '#a0a0a0',
          }}
        >
          <span>Order {caseData.order_number}</span>
          <span style={{ color: '#333' }}>·</span>
          <span>{formatDistanceToNow(new Date(caseData.created_at), { addSuffix: true })}</span>
        </div>

        {/* Progress bar */}
        <ProgressBar status={caseData.status} color={borderColor} />

        {/* Timer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <ResponseTimer createdAt={caseData.created_at} status={caseData.status} />
        </div>
      </div>
    </motion.div>
  );
}
