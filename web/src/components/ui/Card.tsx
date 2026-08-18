import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ padded = true, className, children, ...rest }: CardProps) {
  return (
    <div className={cx('lk-card', padded && 'p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold tracking-tight lk-strong">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm lk-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed lk-border px-6 py-10 text-center">
      {icon && <div className="mb-3 text-3xl opacity-70">{icon}</div>}
      <p className="font-semibold lk-strong">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm lk-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
