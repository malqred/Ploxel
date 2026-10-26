import React, { forwardRef, useCallback, useState } from 'react';

type Variant = 'primary' | 'secondary' | 'neutral' | 'purple' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  glow?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, glow, icon, children, className = '', disabled, onClick, ...rest },
  ref
) {
  const [pressed, setPressed] = useState(false);
  const [kbPressed, setKbPressed] = useState(false);

  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    glow ? 'btn--play' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') setKbPressed(true);
    rest.onKeyDown?.(e);
  };
  const handleKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') setKbPressed(false);
    rest.onKeyUp?.(e);
  };

  return (
    <button
      {...rest}
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      data-pressed={pressed || kbPressed ? 'true' : undefined}
      onPointerDown={(e) => {
        if (!disabled && !loading) setPressed(true);
        rest.onPointerDown?.(e);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onClick={onClick}
    >
      {loading ? <span className="btn__spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  ghost?: boolean;
}

export function IconButton({ label, size = 'md', ghost, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`icon-btn ${size === 'sm' ? 'icon-btn--sm' : ''} ${ghost ? 'icon-btn--ghost' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

/** Кнопка-пилюля для выбора из набора (например, фильтры). */
export function ChipButton({
  active,
  onClick,
  children
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="chip chip--button" data-active={active ? 'true' : undefined} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function useAsyncAction(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, [busy, fn]);
  return { busy, run };
}