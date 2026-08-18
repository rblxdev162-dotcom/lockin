import { cx } from '../../lib/cx';

export function ProgressBar({
  value,
  max,
  tone = 'brand',
  className,
}: {
  value: number;
  max: number;
  tone?: 'brand' | 'mint' | 'flame';
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = {
    brand: 'bg-brand-500',
    mint: 'bg-mint-500',
    flame: 'bg-flame-500',
  }[tone];
  return (
    <div
      className={cx('lk-sunken h-2.5 w-full overflow-hidden rounded-full', className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function RingProgress({
  value,
  max,
  size = 220,
  stroke = 12,
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-black/8 dark:stroke-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className="stroke-brand-500 transition-[stroke-dashoffset] duration-500 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
