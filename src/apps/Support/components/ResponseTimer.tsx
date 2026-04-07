import { Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { calculateBusinessDaysOpen } from '@/lib/businessDays';
import { CaseStatus } from '@/lib/types';
import { useState, useEffect } from 'react';

interface ResponseTimerProps {
  createdAt: string;
  status: CaseStatus;
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (totalHours < 1) return `${totalMinutes}m`;
  if (totalHours < 24) return `${totalHours}h ${String(minutes).padStart(2, '0')}m`;
  return `${days}d ${hours}h`;
}

export function ResponseTimer({ createdAt, status }: ResponseTimerProps) {
  const [now, setNow] = useState(Date.now());
  const hidden = status === 'closed';

  useEffect(() => {
    if (hidden) return;
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [hidden]);

  if (hidden) return null;

  const elapsed = now - new Date(createdAt).getTime();
  const display = formatElapsed(elapsed);
  const businessDays = calculateBusinessDaysOpen(new Date(createdAt));
  const isOverdue = businessDays > 1;
  const isPulsing = businessDays > 2;

  const colorClass = isOverdue ? 'text-status-urgent' : 'text-status-neutral';

  const content = (
    <span className={`inline-flex items-center gap-1.5 text-xs ${colorClass}`}>
      <Clock className="h-3.5 w-3.5" />
      {display}
    </span>
  );

  if (isPulsing) {
    return (
      <motion.div
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {content}
      </motion.div>
    );
  }

  return content;
}
