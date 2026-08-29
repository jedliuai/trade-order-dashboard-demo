import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonTone = 'primary' | 'secondary' | 'subtle' | 'warning' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const toneClasses: Record<ButtonTone, string> = {
  primary: 'border-transparent bg-gradient-to-r from-brand-cyan to-brand-blue text-white shadow-[0_8px_20px_rgba(176,137,86,0.18)] hover:brightness-105',
  secondary: 'border-border bg-surface text-body hover:border-border-strong hover:bg-surface-muted hover:text-ink',
  subtle: 'border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/18',
  warning: 'border-transparent bg-brand-amber text-white shadow-[0_8px_20px_rgba(196,153,66,0.16)] hover:brightness-95',
  danger: 'border-transparent bg-brand-rose text-white shadow-[0_8px_20px_rgba(171,76,76,0.16)] hover:brightness-95'
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 rounded-lg px-3 text-xs',
  md: 'h-10 rounded-[10px] px-4 text-xs',
  lg: 'h-11 rounded-xl px-5 text-sm'
};

export function Button({
  children,
  icon,
  tone = 'primary',
  size = 'md',
  fullWidth = false,
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-2 border font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses[size]} ${toneClasses[tone]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
