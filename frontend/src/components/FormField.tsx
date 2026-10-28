import React, { cloneElement, isValidElement, useId, type ReactElement } from 'react';

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
}) => {
  const generatedId = `field-${useId().replace(/:/g, '')}`;
  const nativeControl = isValidElement(children)
    && typeof children.type === 'string'
    && ['input', 'select', 'textarea'].includes(children.type);
  type NativeControlProps = {
    id?: string;
    required?: boolean;
    'aria-invalid'?: React.AriaAttributes['aria-invalid'];
    'aria-describedby'?: string;
  };
  const childProps = nativeControl ? (children.props as NativeControlProps) : {};
  const controlId = htmlFor || childProps.id || (nativeControl ? generatedId : undefined);
  const messageId = `${controlId || generatedId}-${error ? 'error' : 'hint'}`;
  const describedBy = [childProps['aria-describedby'], (error || hint) ? messageId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
  const control = nativeControl
    ? cloneElement(children as ReactElement<NativeControlProps>, {
        id: controlId,
        required: childProps.required ?? (required || undefined),
        'aria-invalid': childProps['aria-invalid'] ?? (error ? true : undefined),
        'aria-describedby': describedBy
      })
    : children;
  const labelContent = (
    <>
      {label} {required && <span className="text-brand-rose" aria-hidden="true">*</span>}
      {required && <span className="sr-only">（必填）</span>}
    </>
  );

  return (
    <div className={`space-y-1 ${className}`}>
      {controlId ? (
        <label htmlFor={controlId} className="text-xs font-medium text-muted">{labelContent}</label>
      ) : (
        <div className="text-xs font-medium text-muted">{labelContent}</div>
      )}
      {control}
      {error ? (
        <p id={messageId} role="alert" className="text-[11px] leading-5 text-brand-rose">{error}</p>
      ) : hint ? (
        <p id={messageId} className="text-[10px] leading-5 text-subtle">{hint}</p>
      ) : null}
    </div>
  );
};
