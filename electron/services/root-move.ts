import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getRoot, setRoot } from './paths';

/**
 * Перенос папки данных на другой диск.
 *
 * Сначала полностью копируем дерево и сверяем число файлов, и только потом
 * переключаем корень. Старую папку удаляем лишь по явному выбору и только
 * если в ней нет посторонних файлов.
 */

export interface MoveProgress {
  copiedBytes: number;
  totalBytes: number;
  copiedFiles: number;
  totalFiles: number;
  file: string;
}

export interface MoveResult {
  root: string;
  oldRoot: string;
  bytes: number;
  files: number;
  deletedOld: boolean;
}

export class MoveCancelled extends Error {
  constructor() {
    super('Перенос отменён');
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Проверка папки назначения до начала переноса. */
export function checkMoveTarget(nextRaw: string, currentRoot = getRoot()): string {
  const current = path.resolve(currentRoot);
  const next = path.resolve(nextRaw);
  if (!nextRaw.trim()) throw new Error('Не выбрана папка');
  if (current.toLowerCase() === next.toLowerCase()) throw new Error('Эта папка уже используется');
  if (isInside(current, next)) throw new Error('Нельзя выбрать папку внутри текущей папки данных');
  if (isInside(next, current)) throw new Error('Нельзя выбрать папку, в которой лежит текущая папка данных');
  return next;
}

/** Размер и число файлов в дереве. Символические ссылки не учитываем. */
export async function measureTree(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const st = await fsp.stat(full);
          bytes += st.size;
          files++;
        } catch {
          /* пропускаем исчезнувший файл */
        }
      } else if (entry.isSymbolicLink()) {
        continue;
      }
    }
  }
  return { bytes, files };
}

async function copyTree(src: string, dest: string, progress: MoveProgress, tick: () => void, signal: AbortSignal): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (signal.aborted) throw new MoveCancelled();
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, progress, tick, signal);
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
      const st = await fsp.stat(from);
      progress.copiedBytes += st.size;
      progress.copiedFiles++;
      progress.file = entry.name;
      tick();
    }
  }
}

/** Свободное место на диске, где лежит папка. */
export async function freeSpaceAt(target: string): Promise<number | null> {
  let current = path.resolve(target);
  for (;;) {
    try {
      const st = await fsp.statfs(current);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/** Посторонние файлы в старой папке — тогда её не удаляем. */
async function onlyKnownEntries(dir: string): Promise<boolean> {
  const known = new Set([
    'data',
    'instances',
    'logs',
    'cache',
    'downloads',
    'backups',
    'settings.json',
    'settings.json.tmp',
    'root.json'
  ]);
  try {
    const entries = await fsp.readdir(dir);
    return entries.every((name) => known.has(name));
  } catch {
    return false;
  }
}

export async function moveDataRoot(
  nextRaw: string,
  options: {
    deleteOld?: boolean;
    onProgress?: (p: MoveProgress) => void;
    signal?: AbortSignal;
    /** откуда переносим (по умолчанию — текущий корень) */
    from?: string;
    /** как переключить корень (по умолчанию setRoot) */
    onSwitch?: (root: string) => void;
  } = {}
): Promise<MoveResult> {
  const current = path.resolve(options.from ?? getRoot());
  const next = checkMoveTarget(nextRaw, current);
  const { bytes, files } = await measureTree(current);

  const free = await freeSpaceAt(next);
  if (free !== null && free < bytes * 1.02) {
    throw new Error(`На выбранном диске недостаточно места: нужно ${Math.ceil(bytes / 1024 ** 3)} ГБ`);
  }

  const signal = options.signal ?? new AbortController().signal;
  const progress: MoveProgress = { copiedBytes: 0, totalBytes: bytes, copiedFiles: 0, totalFiles: files, file: '' };
  let last = 0;
  const tick = () => {
    const now = Date.now();
    if (now - last < 150 && progress.copiedBytes < bytes) return;
    last = now;
    options.onProgress?.({ ...progress });
  };

  await fsp.mkdir(next, { recursive: true });
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (signal.aborted) throw new MoveCancelled();
    const from = path.join(current, entry.name);
    const to = path.join(next, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, progress, tick, signal);
    else if (entry.isFile()) {
      await fsp.copyFile(from, to);
      const st = await fsp.stat(from);
      progress.copiedBytes += st.size;
      progress.copiedFiles++;
      progress.file = entry.name;
      tick();
    }
  }

  const copied = await measureTree(next);
  if (files > 0 && copied.files < files) {
    throw new Error('Перенос не завершён: скопировано меньше файлов, чем было. Данные на старом месте не тронуты.');
  }

  const switchRoot = options.onSwitch ?? setRoot;
  switchRoot(next);

  let deletedOld = false;
  if (options.deleteOld && (await onlyKnownEntries(current))) {
    try {
      await fsp.rm(current, { recursive: true, force: true });
      deletedOld = true;
    } catch {
      deletedOld = false;
    }
  }

  options.onProgress?.({ ...progress, copiedBytes: bytes, copiedFiles: files });
  return { root: next, oldRoot: current, bytes, files: copied.files, deletedOld };
}