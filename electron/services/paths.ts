import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Пути приложения.
 *
 * Корень данных по умолчанию — папка пользователя приложения
 * (%APPDATA%\Ploxel). Пользователь может выбрать другой корень в настройках;
 * тогда в userData лежит маленький файл-указатель root.json, чтобы при
 * следующем запуске мы нашли данные на новом месте.
 */

const DIRS = [
  'data',
  'data/versions',
  'data/libraries',
  'data/assets',
  'data/java',
  'instances',
  'logs',
  'cache',
  'downloads',
  'backups',
  'backgrounds'
] as const;

let root = '';

export function initPaths(): void {
  const userData = app.getPath('userData');
  const pointer = path.join(userData, 'root.json');
  let configured: string | null = null;
  try {
    if (fs.existsSync(pointer)) {
      configured = JSON.parse(fs.readFileSync(pointer, 'utf8')).root ?? null;
    }
  } catch {
    configured = null;
  }
  root = configured ?? path.join(userData, 'data-root');
  ensureDirs();
}

export function ensureDirs(): void {
  for (const d of DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
}

export function getRoot(): string {
  return root;
}

export interface DriveInfo {
  path: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
}

/** Доступные диски (Windows) или корень файловой системы — с местом. */
export function listDrives(): DriveInfo[] {
  const info = (p: string): DriveInfo | null => {
    try {
      const st = fs.statfsSync(p);
      return {
        path: p,
        label: p.replace(/[\\/]+$/, ''),
        totalBytes: Number(st.blocks) * Number(st.bsize),
        freeBytes: Number(st.bavail) * Number(st.bsize)
      };
    } catch {
      return null;
    }
  };
  if (process.platform !== 'win32') {
    const rootPath = path.parse(root || process.cwd()).root;
    const one = info(rootPath);
    return one ? [one] : [];
  }
  const out: DriveInfo[] = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const drive = `${letter}:\\`;
    if (!fs.existsSync(drive)) continue;
    const entry = info(drive);
    if (entry) out.push(entry);
  }
  return out;
}

export function setRoot(newRoot: string): void {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'root.json'), JSON.stringify({ root: newRoot }, null, 2), 'utf8');
  root = newRoot;
  ensureDirs();
}

export type PathKey = (typeof DIRS)[number];

export function p(key: PathKey, ...rest: string[]): string {
  return path.join(root, key, ...rest);
}

export function data(...rest: string[]): string {
  return path.join(root, 'data', ...rest);
}

export function instanceDir(id: string): string {
  return path.join(root, 'instances', id);
}