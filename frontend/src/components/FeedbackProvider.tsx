import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';

type ToastTone = 'success' | 'error' | 'warning' | 'info';
type ConfirmTone = 'danger' | 'warning' | 'primary';

interface NotificationOptions {
  title?: string;
  message: string;
  tone?: ToastTone;
  duration?: number;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ToastItem extends Required<Pick<NotificationOptions, 'message' | 'tone'>> {
  id: number;
  title?: string;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface FeedbackContextValue {
  notify: (options: NotificationOptions) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const toastToneStyles: Record<ToastTone, { icon: React.ReactNode; border: string; iconClass: string }> = {
  success: {
    icon: <CheckCircle2 className="h-5 w-5" />,
    border: 'border-brand-emerald/30',
    iconClass: 'text-brand-emerald'
  },
  error: {
    icon: <XCircle className="h-5 w-5" />,
    border: 'border-brand-rose/30',
    iconClass: 'text-brand-rose'
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5" />,
    border: 'border-brand-amber/35',
    iconClass: 'text-brand-amber'
  },
  info: {
    icon: <Info className="h-5 w-5" />,
    border: 'border-brand-cyan/30',
    iconClass: 'text-brand-cyan'
  }
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const toastIdRef = useRef(0);
  const pendingConfirmRef = useRef<PendingConfirm | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const notify = useCallback((options: NotificationOptions) => {
    const id = ++toastIdRef.current;
    const duration = options.duration ?? (options.tone === 'error' ? 7000 : 4500);
    setToasts(current => [...current.slice(-3), {
      id,
      title: options.title,
      message: options.message,
      tone: options.tone ?? 'info'
    }]);
    window.setTimeout(() => dismissToast(id), duration);
  }, [dismissToast]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingConfirmRef.current?.resolve(false);
    const nextConfirm = { ...options, resolve };
    pendingConfirmRef.current = nextConfirm;
    setPendingConfirm(nextConfirm);
  }), []);

  const settleConfirm = useCallback((confirmed: boolean) => {
    const current = pendingConfirmRef.current;
    pendingConfirmRef.current = null;
    setPendingConfirm(null);
    current?.resolve(confirmed);
  }, []);

  useEffect(() => () => {
    pendingConfirmRef.current?.resolve(false);
    pendingConfirmRef.current = null;
  }, []);

  const value = useMemo(() => ({ notify, confirm }), [confirm, notify]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-3 sm:right-6 sm:top-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map(toast => {
          const style = toastToneStyles[toast.tone];
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${style.border} bg-white/95 p-4 shadow-[0_16px_45px_rgba(74,66,56,0.16)] backdrop-blur-md`}
            >
              <span className={`mt-0.5 shrink-0 ${style.iconClass}`}>{style.icon}</span>
              <div className="min-w-0 flex-1">
                {toast.title && <p className="text-sm font-semibold text-ink">{toast.title}</p>}
                <p className="whitespace-pre-line text-sm leading-6 text-body">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-muted hover:text-ink"
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {pendingConfirm && (
        <Dialog
          ariaLabel={pendingConfirm.title}
          onClose={() => settleConfirm(false)}
          closeOnBackdrop={false}
        >
          <div className="dialog-panel w-full max-w-lg p-6 sm:p-7">
            <div className="flex items-start gap-4">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${pendingConfirm.tone === 'danger' ? 'bg-brand-rose/10 text-brand-rose' : 'bg-brand-amber/10 text-brand-amber'}`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink">{pendingConfirm.title}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-body">{pendingConfirm.message}</p>
              </div>
            </div>
            <div className="mt-7 flex justify-end gap-3">
              <Button
                type="button"
                onClick={() => settleConfirm(false)}
                tone="secondary"
              >
                {pendingConfirm.cancelLabel ?? '取消'}
              </Button>
              <Button
                type="button"
                onClick={() => settleConfirm(true)}
                tone={pendingConfirm.tone === 'danger' ? 'danger' : pendingConfirm.tone === 'warning' ? 'warning' : 'primary'}
              >
                {pendingConfirm.confirmLabel ?? '确认'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </FeedbackContext.Provider>
  );
};

// oxlint-disable-next-line react/only-export-components -- provider and hook intentionally share one private context.
export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback 必须在 FeedbackProvider 内使用');
  return context;
}
