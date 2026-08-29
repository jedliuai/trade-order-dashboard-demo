import type { ReactNode } from 'react';

interface DataTableProps {
  children: ReactNode;
  ariaLabel: string;
  className?: string;
  tableClassName?: string;
}

export function DataTable({ children, ariaLabel, className = '', tableClassName = '' }: DataTableProps) {
  return (
    <div className={`min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm ${className}`}>
      <div className="overflow-x-auto">
        <table aria-label={ariaLabel} className={`w-full border-collapse text-left ${tableClassName}`}>
          {children}
        </table>
      </div>
    </div>
  );
}
