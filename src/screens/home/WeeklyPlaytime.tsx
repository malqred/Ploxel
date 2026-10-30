import { useEffect, useState } from 'react';
import { api } from '../../api';
import { fmtPlaytime } from '../../i18n';

interface InstanceShare {
  id: string;
  name: string;
  minutes: number;
  percent: number;
}

interface WeekSummary {
  totalMinutes: number;
  days: { day: string; minutes: number }[];
  today: string;
  instances: InstanceShare[];
  byDay?: Record<string, InstanceShare[]>;
}

/** Короткое название дня на языке интерфейса (Пн, Mon, 月…) */
function weekday(date: Date): string {
  const text = date.toLocaleDateString(document.documentElement.lang || 'ru', { weekday: 'short' });
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/\.$/, '');
}

/** «Понедельник, 27 октября» на языке интерфейса */
function longDay(date: Date): string {
  const text = date.toLocaleDateString(document.documentElement.lang || 'ru', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * «Время за неделю»: общий таймер, дни недели и доля каждой сборки.
 * Клик по дню показывает, сколько и во что играли в этот день.
 */
export function WeeklyPlaytime() {
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const load = () => void api.invoke<WeekSummary>('playtime:week').then(setWeek).catch(() => undefined);
    load();
    return api.on('game:exited', () => setTimeout(load, 500));
  }, []);

  const max = Math.max(1, ...(week?.days.map((d) => d.minutes) ?? [1]));
  const day = selected && week ? week.days.find((d) => d.day === selected) : undefined;
  const list = day ? week?.byDay?.[day.day] ?? [] : week?.instances ?? [];
  const dayDate = day ? new Date(`${day.day}T12:00:00`) : null;

  return (
    <section className="panel week">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h2 className="panel__title">{day ? 'Время за день' : 'Время за неделю'}</h2>
        {day && (
          <button className="section-link" onClick={() => setSelected(null)}>
            Вся неделя
          </button>
        )}
      </div>
      <div className="week__total">{week ? fmtPlaytime(day ? day.minutes : week.totalMinutes) : '—'}</div>
      {dayDate && (
        <span className="small muted" data-i18n-skip>
          {longDay(dayDate)}
        </span>
      )}

      <div className="week__days" aria-label="Время по дням">
        {(week?.days ?? Array.from({ length: 7 }, (_, i) => ({ day: String(i), minutes: 0 }))).map((d) => {
          const date = new Date(`${d.day}T12:00:00`);
          const label = Number.isNaN(date.getTime()) ? '' : weekday(date);
          const isToday = !!week && d.day === week.today;
          const future = !!week && d.day > week.today;
          return (
            <button
              key={d.day}
              type="button"
              className={`week__day ${isToday ? 'is-today' : ''}`}
              aria-pressed={selected === d.day}
              disabled={!week || future}
              title={week ? `${label}: ${fmtPlaytime(d.minutes)}` : undefined}
              onClick={() => setSelected((cur) => (cur === d.day ? null : d.day))}
            >
              <span className="week__bar">
                <span style={{ transform: `scaleY(${d.minutes / max})` }} />
              </span>
              <span className="week__label" data-i18n-skip>{label}</span>
            </button>
          );
        })}
      </div>

      {week && list.length === 0 ? (
        <p className="small muted">
          {day
            ? 'В этот день не играли.'
            : 'На этой неделе ещё не играли. Время появится после первой игры.'}
        </p>
      ) : (
        <div className="week__list">
          {list.slice(0, day ? 8 : 5).map((inst) => (
            <div key={inst.id} className="week__row">
              <div className="week__row-head">
                <span className="truncate" data-i18n-skip>
                  {inst.name}
                </span>
                <span className="week__percent">{inst.percent}%</span>
              </div>
              <div className="week__track" role="meter" aria-valuenow={inst.percent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ transform: `scaleX(${inst.percent / 100})` }} />
              </div>
              <span className="tiny muted">{fmtPlaytime(inst.minutes)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
