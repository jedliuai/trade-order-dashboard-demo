import type { ReactNode } from 'react';

export type ColorIconTone = 'teal' | 'green' | 'amber' | 'purple' | 'blue' | 'rose' | 'slate';

interface ColorIconBadgeProps {
  children: ReactNode;
  tone?: ColorIconTone;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  shape?: 'rounded' | 'circle';
  className?: string;
}

const toneClasses: Record<ColorIconTone, string> = {
  teal: 'border-[#ccebe5] bg-[#e6f6f2] text-[#169f91]',
  green: 'border-[#d5ecd1] bg-[#ebf7e8] text-[#4ca657]',
  amber: 'border-[#f4dfb6] bg-[#fff4e2] text-[#db8612]',
  purple: 'border-[#e3d7f6] bg-[#f2ebfc] text-[#8254cc]',
  blue: 'border-[#d5e4f8] bg-[#ebf3fd] text-[#3c79d5]',
  rose: 'border-[#f2d2d6] bg-[#fcebed] text-[#d75a67]',
  slate: 'border-border bg-surface-muted text-muted'
};

const sizeClasses = {
  xs: 'h-7 w-7',
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
  lg: 'h-12 w-12'
} as const;

export function ColorIconBadge({
  children,
  tone = 'teal',
  size = 'md',
  shape = 'rounded',
  className = ''
}: ColorIconBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border ${sizeClasses[size]} ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'} ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
