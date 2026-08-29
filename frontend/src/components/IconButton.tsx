import type { ButtonHTMLAttributes, ReactNode } from 'react';

type IconButtonTone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: ReactNode;
  tone?: IconButtonTone;
  size?: 'sm' | 'md' | 'lg';
}

const toneClasses: Record<IconButtonTone, string> = {
  neutral: 'border-border bg-surface text-muted hover:border-border-strong hover:bg-surface-muted hover:text-ink',
  primary: 'border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20',
  warning: 'border-brand-amber/20 bg-brand-amber/10 text-brand-amber hover:bg-brand-amber/20',
  danger: 'border-brand-rose/20 bg-brand-rose/10 text-brand-rose hover:bg-brand-rose/20',
  success: 'border-brand-emerald/20 bg-brand-emerald/10 text-brand-emerald hover:bg-brand-emerald/20'
};

const sizeClasses = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-10 w-10 rounded-xl'
};

export function IconButton({
  label,
  icon,
  tone = 'neutral',
  size = 'sm',
  type = 'button',
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}
