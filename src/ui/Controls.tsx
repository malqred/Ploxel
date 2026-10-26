import { useId } from 'react';

/* ------------------------------ Тумблер ------------------------------ */

export function Toggle({
  checked,
  onChange,
  disabled,
  danger,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  danger?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${danger ? 'toggle--danger' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ------------------------------ Чекбокс ------------------------------ */

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const state = indeterminate ? 'mixed' : checked ? 'true' : 'false';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      className="checkbox"
      onClick={() => onChange(!checked)}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden>
        {indeterminate ? (
          <path d="M4.5 10h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        ) : (
          <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}

/* ------------------------------ Радиокнопка ------------------------------ */

export function Radio({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="radio"
      onClick={onChange}
    />
  );
}

/* ------------------------------ Вкладки ------------------------------ */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={item.id === value}
          className="tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {typeof item.count === 'number' && <span className="tab__count"> {item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Ползунок ------------------------------ */

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  marks,
  disabled,
  id
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** Подписи под шкалой: строка — равномерно, { value, label } — точно над значением */
  marks?: (string | { value: number; label: string })[];
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider__track-wrap">
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ ['--fill' as string]: `${pct}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider__value" style={{ left: `clamp(18px, ${pct}%, calc(100% - 18px))` }}>
          {format ? format(value) : value}
        </span>
      </div>
      {marks && marks.some((m) => typeof m !== 'string') ? (
        <div className="slider__marks slider__marks--placed">
          {marks.map((m, i) => {
            const mark = typeof m === 'string' ? { value: min + ((max - min) * i) / Math.max(1, marks.length - 1), label: m } : m;
            const at = ((mark.value - min) / (max - min)) * 100;
            const edge = at <= 2 ? 'start' : at >= 98 ? 'end' : 'mid';
            return (
              <span key={mark.label} data-edge={edge} style={{ left: `${at}%` }}>
                {mark.label}
              </span>
            );
          })}
        </div>
      ) : (
        marks && (
          <div className="slider__marks">
            {marks.map((m) => (
              <span key={String(m)}>{String(m)}</span>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------ Прогресс ------------------------------ */

export function ProgressBar({
  value,
  max = 100,
  loading,
  thick,
  label
}: {
  value: number;
  max?: number;
  loading?: boolean;
  thick?: boolean;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={`progress ${thick ? 'progress--thick' : ''}`}
      data-loading={loading ? 'true' : undefined}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__bar" style={{ width: `${pct}%` }} />
      {label && pct > 12 && !loading && <span className="progress__label">{label}</span>}
    </div>
  );
}
