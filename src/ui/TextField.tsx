import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';

/* ------------------------------ Текстовое поле ------------------------------ */

export function TextField({
  value,
  onChange,
  placeholder,
  icon,
  label,
  hint,
  error,
  disabled,
  onEnter,
  type = 'text',
  suffix
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  onEnter?: () => void;
  type?: string;
  suffix?: React.ReactNode;
}) {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      <span className="input-shell" data-invalid={error ? 'true' : undefined}>
        {icon}
        <input
          className="input"
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter?.();
          }}
        />
        {suffix}
      </span>
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <span className="input-shell">
      <Search size={17} />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="icon-btn icon-btn--sm icon-btn--ghost" onClick={() => onChange('')} aria-label="Очистить">
          <X size={14} />
        </button>
      )}
    </span>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  label,
  rows = 4
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  rows?: number;
}) {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      <span className="input-shell input-shell--area">
        <textarea
          className="input"
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

/* ------------------------------ Выпадающий список ------------------------------ */

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

export function Select<T extends string = string>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  width,
  skipLabels
}: {
  value: T | '';
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  skipLabels?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
    up: boolean;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  // Список рисуется в body поверх всей страницы: иначе его обрезают панели
  // и перекрывают карточки, идущие ниже (например, версии в «Новой сборке»).
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const gap = 8;
    const maxHeight = 280;
    const below = window.innerHeight - r.bottom - gap;
    const above = r.top - gap;
    const up = below < Math.min(180, maxHeight) && above > below;
    const menuWidth = Math.max(r.width, 170);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8));
    setPos({
      left,
      width: menuWidth,
      top: up ? undefined : r.bottom + gap,
      bottom: up ? window.innerHeight - r.top + gap : undefined,
      maxHeight: Math.max(120, Math.min(maxHeight, up ? above : below)),
      up
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const onMove = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [value, options, open]);

  const commit = (opt: SelectOption<T>) => {
    onChange(opt.value);
    setOpen(false);
  };

  const menu =
    open && pos
      ? createPortal(
          <div
            className="dropdown"
            role="listbox"
            ref={menuRef}
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.up ? 'auto' : pos.top,
              bottom: pos.up ? pos.bottom : 'auto',
              width: pos.width,
              minWidth: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 'var(--z-popover)'
            }}
          >
            {options.map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                data-active={i === active ? 'true' : undefined}
                className="dropdown__item"
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(opt)}
              >
                {opt.icon}
                <span className="grow" data-i18n-skip={skipLabels ? '' : undefined}>{opt.label}</span>
                {opt.hint && <span className="tiny muted">{opt.hint}</span>}
              </button>
            ))}
            {options.length === 0 && <div className="dropdown__item muted">Нет вариантов</div>}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="select-shell" style={{ width }}>
      <button
        ref={btnRef}
        type="button"
        className="select-btn"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          }
          if (e.key === 'Enter' && open && options[active]) commit(options[active]);
        }}
      >
        {selected?.icon}
        <span className="select-btn__value" data-i18n-skip={skipLabels ? '' : undefined}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown size={16} className="select-btn__chev" />
      </button>
      {menu}
    </div>
  );
}