import React from 'react';

interface FormFieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  htmlFor?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  children,
  required = false,
  hint,
  error,
  className = '',
  htmlFor
}) => (
  <div className={`space-y-1 ${className}`}>
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
      {label} {required && <span className="text-brand-rose" aria-hidden="true">*</span>}
    </label>
    {children}
    {error ? (
      <p className="text-[11px] leading-5 text-brand-rose">{error}</p>
    ) : hint ? (
      <p className="text-[10px] leading-5 text-subtle">{hint}</p>
    ) : null}
  </div>
);
