import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import { instanceDir } from './paths';
import { listWorlds } from './worlds';
import {
  guessWorld,
  leftWorldLogLine,
  serverFromLogLine,
  timeFromScreenshotName,
  type ScreenshotMeta
} from '../core/screenshots';
import type { ScreenshotInfo } from '../../shared/types';

const META = '.ploxel-screenshots.json';
const IMAGE = /\.(png|jpe?g)$/i;

function shotsDir(instanceId: string): string {
  return path.join(instanceDir(instanceId), 'screenshots');
}

function readMeta(instanceId: string): ScreenshotMeta[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(shotsDir(instanceId), META), 'utf8')) as ScreenshotMeta[];
  } catch {
    return [];
  }
}

async function addMeta(instanceId: string, entry: ScreenshotMeta): Promise<void> {
  const list = readMeta(instanceId).filter((m) => m.file !== entry.file);
  list.push(entry);
  await fsp.writeFile(path.join(shotsDir(instanceId), META), JSON.stringify(list.slice(-2000), null, 1), 'utf8');
}

/**
 * Пока игра запущена, запоминаем, в каком мире сделан каждый снимок:
 * открытый мир — по файлу session.lock в saves, сервер — по строке
 * «Connecting to …» в логе. Возвращает обработчик строк лога и остановку.
 */
export function trackScreenshots(instanceId: string): { onLine: (line: string) => void; stop: () => void } {
  const dir = instanceDir(instanceId);
  let world: string | null = null;
  let server: string | null = null;
  const watchers: fs.FSWatcher[] = [];
  const seen = new Set<string>();

  const watch = (target: string, opts: fs.WatchOptions, cb: (name: string) => void) => {
    try {
      fs.mkdirSync(target, { recursive: true });
      const w = fs.watch(target, opts, (_event, name) => name && cb(String(name)));
      w.on('error', () => undefined);
      watchers.push(w);
    } catch {
      /* без слежения — мир угадаем по времени */
    }
  };

  watch(path.join(dir, 'saves'), { recursive: true }, (name) => {
    const parts = name.split(/[\\/]/);
    if (parts.length === 2 && parts[1] === 'session.lock') {
      world = parts[0];
      server = null;
    }
  });
  watch(shotsDir(instanceId), {}, (name) => {
    if (!IMAGE.test(name) || seen.has(name)) return;
    seen.add(name);
    // Файл пишется не мгновенно — записываем мир сразу, время — по имени
    const takenAt = timeFromScreenshotName(name) ?? new Date();
    void addMeta(instanceId, {
      file: name,
      worldFolder: server ? undefined : world ?? undefined,
      server: server ?? undefined,
      takenAt: takenAt.toISOString()
    }).catch(() => undefined);
  });

  return {
    onLine: (line) => {
      const host = serverFromLogLine(line);
      if (host) {
        server = host;
        world = null;
      } else if (leftWorldLogLine(line)) {
        world = null;
        server = null;
      }
    },
    stop: () => {
      for (const w of watchers) w.close();
    }
  };
}

/** Снимки сборки, новые сверху. */
export async function listScreenshots(instanceId: string): Promise<ScreenshotInfo[]> {
  const dir = shotsDir(instanceId);
  let files: string[] = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => IMAGE.test(f));
  } catch {
    return [];
  }
  const meta = new Map(readMeta(instanceId).map((m) => [m.file, m]));
  const worlds = listWorlds(instanceId).map((w) => ({ folder: w.folder, name: w.name, lastPlayed: w.lastPlayed }));
  const worldName = (folder?: string) => worlds.find((w) => w.folder === folder)?.name ?? folder;

  const out: ScreenshotInfo[] = [];
  for (const file of files) {
    let size = 0;
    let mtime = new Date();
    try {
      const st = await fsp.stat(path.join(dir, file));
      size = st.size;
      mtime = st.mtime;
    } catch {
      continue;
    }
    const m = meta.get(file);
    const takenAt = m ? new Date(m.takenAt) : timeFromScreenshotName(file) ?? mtime;
    let world: string | undefined;
    let guessed = false;
    if (m?.server) world = m.server;
    else if (m?.worldFolder) world = worldName(m.worldFolder);
    else if (!m) {
      const folder = guessWorld(takenAt, worlds);
      world = folder ? worldName(folder) : undefined;
      guessed = !!folder && worlds.length > 1;
    }
    out.push({
      file,
      takenAt: takenAt.toISOString(),
      world,
      server: !!m?.server,
      guessed,
      size
    });
  }
  return out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

function safeShot(instanceId: string, file: string): string {
  if (!IMAGE.test(file) || /[\\/:]|\.\./.test(file)) throw new Error('Неверное имя снимка');
  return path.join(shotsDir(instanceId), file);
}

/** «Сохранить как…» — копия снимка в выбранную пользователем папку. */
export async function saveScreenshotAs(instanceId: string, file: string): Promise<string | null> {
  const src = safeShot(instanceId, file);
  const win = BrowserWindow.getFocusedWindow();
  const options: Electron.SaveDialogOptions = {
    title: 'Сохранить снимок',
    defaultPath: file,
    filters: [{ name: 'Картинка', extensions: [path.extname(file).slice(1) || 'png'] }]
  };
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (res.canceled || !res.filePath) return null;
  await fsp.copyFile(src, res.filePath);
  return res.filePath;
}

export function showScreenshotInFolder(instanceId: string, file: string): void {
  shell.showItemInFolder(safeShot(instanceId, file));
}

export async function deleteScreenshot(instanceId: string, file: string): Promise<void> {
  await shell.trashItem(safeShot(instanceId, file)).catch(() => fsp.rm(safeShot(instanceId, file), { force: true }));
}
