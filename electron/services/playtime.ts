import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './paths';
import { listInstances } from './instances';
import { splitByDay, summarizeWeek, type DayEntry, type WeekSummary } from '../core/playtime';

/**
 * Журнал игрового времени по дням: playtime.json в корне данных.
 * Хранится только сборка, дата и минуты — для экрана «Время за неделю».
 * Записи старше 60 дней удаляются.
 */

const KEEP_DAYS = 60;

function file(): string {
  return path.join(getRoot(), 'playtime.json');
}

function read(): DayEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(raw) ? (raw as DayEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordSession(instanceId: string, startedAt: Date, endedAt: Date): void {
  const entries = read();
  for (const part of splitByDay(startedAt, endedAt)) {
    const hit = entries.find((e) => e.instanceId === instanceId && e.day === part.day);
    if (hit) hit.minutes += part.minutes;
    else entries.push({ instanceId, day: part.day, minutes: part.minutes });
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const kept = entries.filter((e) => e.day >= cutoff);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(kept), 'utf8');
  fs.renameSync(tmp, file());
}

export function weekSummary(): WeekSummary {
  const names = new Map(listInstances().map((i) => [i.id, i.name]));
  return summarizeWeek(read(), new Date(), names);
}
