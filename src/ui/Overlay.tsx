import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';

/* ------------------------------ Подсказка ------------------------------ */

export function Tip({
  title,
  sub,
  children,
  side = 'top'
}: {
  title?: string;
  sub?: string;
  children: React.ReactElement;
  side?: 'top' | 'bottom';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !hostRef.current) return;
    const r = hostRef.current.getBoundingClientRect();
    setPos({
      top: side === 'top' ? r.top - 8 : r.bottom + 8,
      left: Math.min(window.innerWidth - 140, Math.max(140, r.left + r.width / 2))
    });
  }, [open, side]);

  return (
    <span
      className="tooltip-host"
      ref={hostRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        pos &&
        createPortal(
          <span
            className="tip"
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
            }}
          >
            {title && <span className="tip__title">{title}</span>}
            {sub}
          </span>,
          document.body
        )}
    </span>
  );
}

/* ------------------------------ Модальное окно ------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  wide,
  xwide,
  full,
  className = ''
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
  xwide?: boolean;
  full?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, button, textarea, select');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'modal--wide' : ''} ${xwide ? 'modal--xwide' : ''} ${full ? 'modal--full' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        ref={ref}
      >
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button className="icon-btn icon-btn--sm icon-btn--ghost" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {actions && <div className="modal__actions">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}