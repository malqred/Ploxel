/**
 * Снимки экрана сборки: время и мир. Сам Minecraft мир в снимок не пишет,
 * поэтому лаунчер записывает его, пока игра запущена, а для старых снимков
 * угадывает по времени.
 */

export interface ScreenshotMeta {
  /** имя файла в папке screenshots */
  file: string;
  /** папка мира в saves, если снимок сделан в одиночной игре */
  worldFolder?: string;
  /** адрес сервера, если снимок сделан в сетевой игре */
  server?: string;
  takenAt: string;
}

/** Время снимка по имени файла Minecraft: 2026-10-28_00.17.10.png (местное время). */
export function timeFromScreenshotName(file: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})\.(\d{2})\.(\d{2})/.exec(file);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Мир для старого снимка: мир, в который зашли последним до снимка, — это
 * мир с самой ранней датой «последней игры», которая не раньше снимка
 * (после снимка игрок ещё был в этом мире). Если мир один — он и есть.
 */
export function guessWorld(
  takenAt: Date,
  worlds: { folder: string; lastPlayed?: string }[]
): string | undefined {
  if (worlds.length === 1) return worlds[0].folder;
  const t = takenAt.getTime();
  let best: { folder: string; at: number } | null = null;
  for (const w of worlds) {
    if (!w.lastPlayed) continue;
    const at = new Date(w.lastPlayed).getTime();
    if (Number.isNaN(at) || at < t - 60_000) continue;
    if (!best || at < best.at) best = { folder: w.folder, at };
  }
  return best?.folder;
}

/** Адрес сервера из строки лога «Connecting to host, 25565». */
export function serverFromLogLine(line: string): string | null {
  const m = /Connecting to ([^\s,]+), ?(\d+)/.exec(line);
  if (!m) return null;
  return m[2] === '25565' ? m[1] : `${m[1]}:${m[2]}`;
}

/** Строка лога «из мира вышли»: одиночная игра остановлена или соединение закрыто. */
export function leftWorldLogLine(line: string): boolean {
  return /Stopping server|Stopping singleplayer server|Disconnected from server|lost connection/i.test(line);
}
