import type { ReactNode } from 'react';

export function Section({
  title,
  hint,
  children,
  actions
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel settings-section">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 className="settings-section__title">{title}</h2>
          {hint && <p className="small muted" style={{ marginTop: 2 }}>{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
  stack
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={`setting-row ${stack ? 'setting-row--stack' : ''}`}>
      <div className="setting-row__text">
        <span className="setting-row__label">{label}</span>
        {hint && <span className="setting-row__hint">{hint}</span>}
      </div>
      <div className="setting-row__control" style={stack ? { width: '100%', marginTop: 8 } : undefined}>
        {children}
      </div>
    </div>
  );
}