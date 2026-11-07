import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import { contentDir } from './mods';
import { emit } from './events';
import { catalogProject, catalogVersions } from './catalog';
import type { CatalogVersion, Instance, ManualFile } from '../../shared/types';

/**
 * Файлы, которые автор разрешил скачивать только с сайта CurseForge. Пользователь
 * нажимает «Скачать» — браузер кладёт файл в «Загрузки», а лаунчер находит его там
 * (по размеру и SHA-1 из CurseForge) и копирует в нужную сборку. Так делают и другие
 * лаунчеры: условие CurseForge соблюдено, а от человека нужен один клик.
 */

export interface ManualStatus extends ManualFile {
  done: boolean;
}

const pending = new Map<string, ManualStatus>();
let watcher: fs.FSWatcher | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
let stopAt = 0;
/** Сколько ждём файлы после последнего «Скачать» */
const WATCH_MS = 30 * 60 * 1000;

const key = (f: ManualFile) => `${f.instanceId}|${f.fileName}`;

/** Папка, где браузер сохраняет файлы (для проверок её можно подменить). */
export function downloadsDir(): string {
  return process.env.PLOXEL_DOWNLOADS_DIR || app.getPath('downloads');
}

export function manualStatuses(instanceId?: string): ManualStatus[] {
  return [...pending.values()].filter((s) => !instanceId || s.instanceId === instanceId);
}

/** Начать ждать файлы. Уже скачанные раньше находятся сразу. */
export async function watchManualFiles(files: ManualFile[]): Promise<ManualStatus[]> {
  for (const f of files) {
    if (!pending.has(key(f))) pending.set(key(f), { ...f, done: false });
  }
  stopAt = Date.now() + WATCH_MS;
  startWatching();
  await scan();
  return manualStatuses(files[0]?.instanceId);
}

/** Пользователь указал файл сам (скачал в другую папку). */
export async function useManualFile(instanceId: string, fileName: string, file: string): Promise<ManualStatus> {
  const item = pending.get(`${instanceId}|${fileName}`);
  if (!item) throw new Error('Этот файл лаунчер уже не ждёт');
  if (!(await matches(item, file))) {
    throw new Error(`Это другой файл. Нужен ${item.fileName} — скачайте его кнопкой «Скачать».`);
  }
  await install(item, file);
  return item;
}

function startWatching() {
  const dir = downloadsDir();
  if (!watcher) {
    try {
      watcher = fs.watch(dir, () => queueScan());
      watcher.on('error', () => stopWatcher());
    } catch {
      watcher = null; // папки нет или нет доступа — остаётся опрос
    }
  }
  // Запасной опрос: события файловой системы иногда теряются (сетевые диски, антивирус)
  poll ??= setInterval(() => queueScan(), 3000);
}

function stopWatcher() {
  watcher?.close();
  watcher = null;
  if (poll) clearInterval(poll);
  poll = null;
}

function queueScan() {
  if (scanTimer) return;
  // Браузер дописывает файл частями — даём ему закончить
  scanTimer = setTimeout(() => {
    scanTimer = null;
    void scan();
  }, 800);
}

async function scan(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const waiting = [...pending.values()].filter((s) => !s.done);
    if (!waiting.length || Date.now() > stopAt) {
      stopWatcher();
      return;
    }
    let names: string[] = [];
    try {
      names = await fsp.readdir(downloadsDir());
    } catch {
      return;
    }
    for (const item of waiting) {
      for (const name of candidates(item, names)) {
        const file = path.join(downloadsDir(), name);
        if (await matches(item, file)) {
          await install(item, file).catch((e) => console.warn('[manual]', e));
          break;
        }
      }
    }
  } finally {
    scanning = false;
  }
}

/** Похожие по имени — первыми: «x.jar», «x (1).jar»; затем любые файлы того же расширения. */
function candidates(item: ManualFile, names: string[]): string[] {
  const ext = path.extname(item.fileName).toLowerCase();
  const base = item.fileName.slice(0, item.fileName.length - ext.length).toLowerCase();
  const same = names.filter((n) => {
    const l = n.toLowerCase();
    return l === item.fileName.toLowerCase() || (l.startsWith(base) && l.endsWith(ext));
  });
  const other = names.filter((n) => n.toLowerCase().endsWith(ext) && !same.includes(n));
  return [...same, ...other];
}

async function matches(item: ManualFile, file: string): Promise<boolean> {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return false;
    if (item.size > 0 && st.size !== item.size) return false;
    if (!item.sha1) return path.basename(file).toLowerCase() === item.fileName.toLowerCase();
    const hash = crypto.createHash('sha1').update(await fsp.readFile(file)).digest('hex');
    return hash.toLowerCase() === item.sha1.toLowerCase();
  } catch {
    return false;
  }
}

/** Файл переносится (не копируется): в «Загрузках» он больше не занимает место. */
async function install(item: ManualStatus, file: string) {
  const dir = contentDir(item.instanceId, item.kind);
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, item.fileName);
  try {
    await fsp.rename(file, dest);
  } catch {
    // Другой диск (rename между дисками не работает) или файл ещё занят браузером
    await fsp.copyFile(file, dest);
    await fsp.rm(file, { force: true }).catch(() => undefined);
  }
  item.done = true;
  emit('manual:status', { instanceId: item.instanceId, fileName: item.fileName, title: item.title, done: true });
}

/** Для проверок: забыть всё и остановить слежение. */
export function resetManualFiles() {
  pending.clear();
  stopWatcher();
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
}

/** Страница загрузки конкретного файла CurseForge (там браузер сам начнёт скачивание). */
export function manualPageUrl(projectUrl: string, fileId: string): string {
  return `${projectUrl.replace(/\/+$/, '')}/download/${fileId}`;
}

/** Закрытый файл версии → что ждать в «Загрузках». null — файл можно скачать обычным способом. */
export function manualFromVersion(
  instanceId: string,
  kind: ManualFile['kind'],
  title: string,
  projectUrl: string,
  version: CatalogVersion
): ManualFile | null {
  const b = version.blockedFile;
  if (!b || !projectUrl) return null;
  return { instanceId, kind, title, pageUrl: manualPageUrl(projectUrl, version.id), fileName: b.fileName, size: b.size, sha1: b.sha1 };
}

/** Проект CurseForge, который не скачать через лаунчер: ищем его файл под сборку. */
export async function manualForProject(
  instance: Instance,
  source: 'modrinth' | 'curseforge',
  projectId: string,
  kind: ManualFile['kind'],
  versionId?: string
): Promise<ManualFile | null> {
  if (source !== 'curseforge') return null;
  const loader = kind === 'mod' && instance.loader.kind !== 'vanilla' ? instance.loader.kind : undefined;
  const versions = await catalogVersions(source, projectId, instance.gameVersion, loader);
  const version = (versionId && versions.find((v) => v.id === versionId)) || versions.find((v) => v.blockedFile);
  if (!version) return null;
  const info = await catalogProject(source, projectId).catch(() => null);
  return manualFromVersion(instance.id, kind, info?.title ?? projectId, info?.url ?? '', version);
}
