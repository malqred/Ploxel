/**
 * Процент установки модпака по этапам: архив 0–8, загрузчик 8–18, файлы
 * модпака 18–95 (по числу файлов), настройки 95–99, готово — 100.
 */
export function modpackPercent(phase: string, done: number, total: number): number {
  const part = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  if (phase === 'Готово') return 100;
  if (phase.startsWith('Скачивание')) return Math.round(8 * part);
  if (phase.startsWith('Создание')) return 8;
  if (phase.startsWith('Установка')) return 10 + Math.round(8 * part);
  if (phase.startsWith('Файлы')) return 18 + Math.round(77 * part);
  if (phase.startsWith('Распаковка')) return 95 + Math.round(4 * part);
  return 0;
}

/**
 * Процент запуска игры по этапам: Java 0–25, клиент 25–35, библиотеки 35–50,
 * ассеты 50–97, запуск — 100. Счётчик каждого этапа начинается с нуля, поэтому
 * без общего процента карточка загрузок «застревала» на 100% после первого этапа.
 */
export function launchPercent(phase: string, done: number, total: number): number {
  const part = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const span = (from: number, to: number) => Math.round(from + (to - from) * part);
  if (phase === 'Загрузка Java') return span(0, 25);
  if (phase === 'Проверка файлов игры') return 25;
  if (phase === 'Клиент игры') return span(25, 35);
  if (phase === 'Библиотеки') return span(35, 50);
  if (phase === 'Ассеты') return span(50, 97);
  if (phase === 'Подготовка Ely.by') return 97;
  if (phase === 'Запуск игры') return 100;
  return 0;
}

/**
 * Общий процент в карточке загрузок. Если идут «операции» (сборка, модпак,
 * запуск — задачи со счётчиком шагов без байтов), процент — по ним: файлы
 * внутри операции — лишь её часть. Иначе — по байтам всех файлов, а если
 * размеры неизвестны — по числу файлов.
 */
export function overallPercent(
  tasks: { id: string; status: string; done: number; total: number; bytesDone?: number; bytesTotal?: number }[]
): number {
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'paused');
  if (!active.length) return 0;
  const pct = (t: (typeof active)[number]) =>
    t.bytesTotal ? (t.bytesDone ?? 0) / t.bytesTotal : t.total ? t.done / t.total : 0;
  const operations = active.filter((t) => !t.id.startsWith('batch:') && !t.bytesTotal && t.total > 0);
  if (operations.length) return clamp(operations.reduce((n, t) => n + pct(t), 0) / operations.length);
  if (active.every((t) => (t.bytesTotal ?? 0) > 0)) {
    const total = active.reduce((n, t) => n + (t.bytesTotal ?? 0), 0);
    return clamp(active.reduce((n, t) => n + (t.bytesDone ?? 0), 0) / total);
  }
  return clamp(active.reduce((n, t) => n + pct(t), 0) / active.length);
}

function clamp(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x * 100)));
}
