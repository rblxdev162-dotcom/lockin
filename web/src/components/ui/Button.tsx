import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 shadow-sm shadow-brand-900/20',
  secondary:
    'lk-raised lk-strong border lk-border hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300',
  ghost: 'lk-muted hover:lk-sunken hover:lk-strong',
  danger: 'bg-flame-600 text-white hover:bg-flame-500 active:bg-flame-600',
  success: 'bg-mint-600 text-white hover:bg-mint-500 active:bg-mint-600',
};

const SIZES: Record<Size, string> = {
  sm: 'text-sm px-3 py-1.5 rounded-lg gap-1.5',
  md: 'text-sm px-4 py-2.5 rounded-xl gap-2',
  lg: 'text-base px-6 py-3.5 rounded-2xl gap-2',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  icon,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
        'active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
