import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ToastMessage } from '../../shared/types';

interface ToastApi {
  toast: (kind: ToastMessage['kind'], title: string, description?: string) => void;
  remove: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const remove = useCallback((id: string) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (kind: ToastMessage['kind'], title: string, description?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((list) => [...list.slice(-3), { id, kind, title, description }]);
      window.setTimeout(() => remove(id), kind === 'error' ? 7000 : 4500);
    },
    [remove]
  );

  const value = useMemo(() => ({ toast, remove }), [toast, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => {
            const Icon = ICONS[t.kind];
            return (
              <div key={t.id} className="toast" data-kind={t.kind} onClick={() => remove(t.id)}>
                <Icon size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                <div className="grow">
                  <div className="toast__title">{t.title}</div>
                  {t.description && <div className="toast__desc">{t.description}</div>}
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast должен вызываться внутри ToastProvider');
  return ctx;
}