import React from 'react';

export function EmptyState({
  icon,
  title,
  hint,
  action
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <span className="empty__icon">{icon}</span>}
      <span className="empty__title">{title}</span>
      {hint && <span className="small" style={{ maxWidth: 420 }}>{hint}</span>}
      {action}
    </div>
  );
}

export function ScreenHeader({
  title,
  sub,
  actions
}: {
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="screen-head">
      <div>
        <h1 className="screen-title">{title}</h1>
        {sub && <p className="screen-sub">{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

/** Временная заглушка экрана на время сборки — заменяется реализацией. */
export function ComingSoon({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="screen">
      <ScreenHeader title={title} />
      <div className="panel">
        <EmptyState title="Раздел в разработке" hint={hint ?? 'Скоро здесь появится содержимое.'} />
      </div>
    </div>
  );
}