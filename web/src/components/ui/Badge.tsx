import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import type { Platform, Priority, Status } from '../../types';

const TONES = {
  neutral: 'lk-sunken lk-muted border lk-border',
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
  mint: 'bg-mint-400/20 text-mint-600 dark:text-mint-400',
  flame: 'bg-flame-400/20 text-flame-600 dark:text-flame-400',
  amber: 'bg-amber-400/20 text-amber-700 dark:text-amber-300',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone: BadgeTone =
    priority === 'Urgent' ? 'flame' : priority === 'Important' ? 'amber' : 'neutral';
  return <Badge tone={tone}>{priority}</Badge>;
}

export function StatusBadge({ status }: { status: Status }) {
  const tone: BadgeTone =
    status === 'Completed' ? 'mint' : status === 'In Progress' ? 'brand' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

export function PlatformBadge({ platform }: { platform: Platform }) {
  return <Badge tone={platform === 'Other' ? 'neutral' : 'brand'}>{platform}</Badge>;
}
