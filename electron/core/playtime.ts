/** Чистая логика игрового времени: разбивка сессии по дням и сводка за неделю. */

export interface DayEntry {
  instanceId: string;
  /** локальная дата YYYY-MM-DD */
  day: string;
  minutes: number;
}

export interface WeekSummary {
  totalMinutes: number;
  /** минуты по дням текущей недели: понедельник → воскресенье */
  days: { day: string; minutes: number }[];
  /** сегодняшняя дата YYYY-MM-DD — по ней подсвечивается столбик */
  today: string;
  instances: { id: string; name: string; minutes: number; percent: number }[];
  /** по каждому дню недели: в какие сборки и сколько играли */
  byDay: Record<string, { id: string; name: string; minutes: number; percent: number }[]>;
}

function shares(byInstance: Map<string, number>, total: number, names: Map<string, string>) {
  return [...byInstance.entries()]
    .map(([id, minutes]) => ({
      id,
      name: names.get(id) ?? 'Удалённая сборка',
      minutes,
      percent: total ? Math.round((minutes / total) * 100) : 0
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Сессия через полночь делится между днями. */
export function splitByDay(start: Date, end: Date): { day: string; minutes: number }[] {
  const out: { day: string; minutes: number }[] = [];
  if (end <= start) return out;
  let cur = new Date(start);
  while (cur < end) {
    const midnight = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    const stop = midnight < end ? midnight : end;
    const minutes = (stop.getTime() - cur.getTime()) / 60000;
    out.push({ day: localDay(cur), minutes });
    cur = stop;
  }
  // Округляем так, чтобы сумма совпала с длиной сессии (минимум минута)
  const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  const rounded = out.map((p) => ({ day: p.day, minutes: Math.round(p.minutes) }));
  const diff = total - rounded.reduce((s, p) => s + p.minutes, 0);
  rounded[rounded.length - 1].minutes += diff;
  return rounded.filter((p) => p.minutes > 0);
}

export function summarizeWeek(entries: DayEntry[], now: Date, names: Map<string, string>): WeekSummary {
  // Неделя начинается с понедельника: понедельник…воскресенье текущей недели.
  // Дни после сегодняшнего остаются с нулём — они ещё не наступили.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days: { day: string; minutes: number }[] = [];
  for (let i = 0; i < 7; i++) {
    days.push({ day: localDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)), minutes: 0 });
  }
  const inWeek = new Set(days.map((d) => d.day));
  const byInstance = new Map<string, number>();
  const perDay = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!inWeek.has(e.day)) continue;
    days.find((d) => d.day === e.day)!.minutes += e.minutes;
    byInstance.set(e.instanceId, (byInstance.get(e.instanceId) ?? 0) + e.minutes);
    const day = perDay.get(e.day) ?? new Map<string, number>();
    day.set(e.instanceId, (day.get(e.instanceId) ?? 0) + e.minutes);
    perDay.set(e.day, day);
  }
  const totalMinutes = days.reduce((s, d) => s + d.minutes, 0);
  const byDay: WeekSummary['byDay'] = {};
  for (const d of days) byDay[d.day] = shares(perDay.get(d.day) ?? new Map(), d.minutes, names);
  return { totalMinutes, days, today: localDay(now), instances: shares(byInstance, totalMinutes, names), byDay };
}
