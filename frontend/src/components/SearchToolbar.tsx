import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

interface SearchToolbarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  leading?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SearchToolbar({
  value,
  onChange,
  placeholder,
  ariaLabel,
  leading,
  filters,
  actions,
  className = ''
}: SearchToolbarProps) {
  return (
    <section
      role="search"
      aria-label={ariaLabel}
      className={`glass-panel flex flex-col gap-3 rounded-xl p-4 lg:flex-row lg:items-center ${className}`}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{ariaLabel}</span>
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-xs text-ink placeholder:text-subtle"
        />
      </label>
      {filters && <div className="flex min-w-0 flex-wrap items-center gap-3">{filters}</div>}
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </section>
  );
}
