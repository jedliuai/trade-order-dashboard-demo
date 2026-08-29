import type { HTMLAttributes, ReactNode } from 'react';

export type StatusTone = 'success' | 'progress' | 'warning' | 'danger' | 'neutral' | 'accent';

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: StatusTone;
  size?: 'xs' | 'sm';
  dot?: boolean;
}

const toneClasses: Record<StatusTone, string> = {
  success: 'border-brand-emerald/25 bg-brand-emerald/10 text-brand-emerald',
  progress: 'border-brand-cyan/25 bg-brand-cyan/10 text-brand-cyan',
  warning: 'border-brand-amber/30 bg-brand-amber/10 text-brand-amber',
  danger: 'border-brand-rose/25 bg-brand-rose/10 text-brand-rose',
  neutral: 'border-border bg-surface-muted text-muted',
  accent: 'border-brand-purple/25 bg-brand-purple/10 text-brand-purple'
};

const dotClasses: Record<StatusTone, string> = {
  success: 'bg-brand-emerald',
  progress: 'bg-brand-cyan',
  warning: 'bg-brand-amber',
  danger: 'bg-brand-rose',
  neutral: 'bg-subtle',
  accent: 'bg-brand-purple'
};

export function StatusBadge({
  children,
  tone = 'neutral',
  size = 'xs',
  dot = false,
  className = '',
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border font-semibold leading-none ${
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-2 py-1 text-[10px]'
      } ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses[tone]}`} />}
      <span className="truncate">{children}</span>
    </span>
  );
}
