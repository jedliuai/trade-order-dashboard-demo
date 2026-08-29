import React from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
}

interface FilterPanelProps {
  children: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, leading }) => (
  <div className="flex min-h-14 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      {leading}
      <h2 className="font-heading text-xl font-bold leading-tight text-ink">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">{description}</p>
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
  </div>
);

export const FilterPanel: React.FC<FilterPanelProps> = ({ children, className = '' }) => (
  <div className={`glass-panel rounded-xl p-4 ${className}`}>{children}</div>
);
