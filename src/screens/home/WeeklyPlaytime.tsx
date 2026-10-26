import { useEffect, useState } from 'react';
import { api } from '../../api';
import { fmtPlaytime } from '../../i18n';

interface WeekSummary {
  totalMinutes: number;
  days: { day: string; minutes: number }[];
  today: string;
  instances: { id: string; name: string; minutes: number; percent: number }[];
}

/** Короткое название дня на языке интерфейса (Пн, Mon, 月…) */
function weekday(date: Date): string {
  const text = date.toLocaleDateString(document.documentElement.lang || 'ru', { weekday: 'short' });
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/\.$/, '');
}

/** «Время за неделю»: общий таймер, дни недели и доля каждой сборки. */
export function WeeklyPlaytime() {
  const [week, setWeek] = useState<WeekSummary | null>(null);

  useEffect(() => {
    const load = () => void api.invoke<WeekSummary>('playtime:week').then(setWeek).catch(() => undefined);
    load();
    return api.on('game:exited', () => setTimeout(load, 500));
  }, []);

  const max = Math.max(1, ...(week?.days.map((d) => d.minutes) ?? [1]));

  return (
    <section className="panel week">
      <h2 className="panel__title">Время за неделю</h2>
      <div className="week__total">{week ? fmtPlaytime(week.totalMinutes) : '—'}</div>

      <div className="week__days" aria-label="Время по дням">
        {(week?.days ?? Array.from({ length: 7 }, (_, i) => ({ day: String(i), minutes: 0 }))).map((d) => {
          const date = new Date(`${d.day}T12:00:00`);
          const label = Number.isNaN(date.getTime()) ? '' : weekday(date);
          const isToday = !!week && d.day === week.today;
          return (
            <div
              key={d.day}
              className={`week__day ${isToday ? 'is-today' : ''}`}
              title={week ? `${label}: ${fmtPlaytime(d.minutes)}` : undefined}
            >
              <span className="week__bar">
                <span style={{ transform: `scaleY(${d.minutes / max})` }} />
              </span>
              <span className="week__label" data-i18n-skip>{label}</span>
            </div>
          );
        })}
      </div>

      {week && week.instances.length === 0 ? (
        <p className="small muted">На этой неделе ещё не играли. Время появится после первой игры.</p>
      ) : (
        <div className="week__list">
          {week?.instances.slice(0, 5).map((inst) => (
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
