import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { BrowserWindow, dialog, protocol } from 'electron';
import { getRoot, p } from './paths';
import { mediaKindOf, resolveMediaPath } from '../core/local-media';

/**
 * Локальные картинки и видео для окна: свой фон и снимки экрана сборок.
 * Окно не может читать файлы с диска напрямую (CSP), поэтому отдаём их по
 * схеме ploxel-media:// — и только из своих папок:
 *   ploxel-media://bg/<файл>              — папка backgrounds
 *   ploxel-media://shot/<сборка>/<файл>   — instances/<сборка>/screenshots
 */
export const MEDIA_SCHEME = 'ploxel-media';

/** Вызывать до app.whenReady. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ]);
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/mp4',
  '.m4v': 'video/mp4'
};

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = resolveMediaPath(getRoot(), url.hostname, decodeURIComponent(url.pathname));
    if (!file) return new Response('Not found', { status: 404 });
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Диапазоны нужны видео: без них Chromium не перематывает и не зацикливает ролик
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, Math.min(start, stat.size - 1));
      end = Math.max(start, Math.min(end, stat.size - 1));
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes'
        }
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' }
    });
  });
}

/** Самый большой допустимый файл фона. */
const MAX_BACKGROUND_BYTES = 512 * 1024 * 1024;

export interface PickedBackground {
  mediaFile: string;
  mediaType: 'image' | 'video';
}

/**
 * Выбор своего фона: файл копируется в папку backgrounds (оригинал можно
 * удалить или переместить), прежние фоны оттуда убираются.
 */
export async function pickBackground(win: BrowserWindow | null): Promise<PickedBackground | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Картинка, GIF или видео для фона',
    properties: ['openFile'],
    filters: [
      { name: 'Картинки и видео', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v'] }
    ]
  };
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const source = res.filePaths[0];
  if (res.canceled || !source) return null;
  const type = mediaKindOf(source);
  if (!type) throw new Error('Этот формат не подходит для фона. Подойдут PNG, JPG, WEBP, GIF, MP4, WEBM.');
  const stat = await fsp.stat(source);
  if (stat.size > MAX_BACKGROUND_BYTES) throw new Error('Файл больше 512 МБ — выберите файл поменьше.');

  const dir = p('backgrounds');
  await fsp.mkdir(dir, { recursive: true });
  const name = `background-${crypto.randomBytes(4).toString('hex')}${path.extname(source).toLowerCase()}`;
  await fsp.copyFile(source, path.join(dir, name));
  for (const old of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (old !== name) await fsp.rm(path.join(dir, old), { force: true }).catch(() => undefined);
  }
  return { mediaFile: name, mediaType: type };
}

/** Убрать свой фон с диска (пользователь вернул обычный фон и нажал «Удалить файл»). */
export async function clearBackgrounds(): Promise<void> {
  await fsp.rm(p('backgrounds'), { recursive: true, force: true }).catch(() => undefined);
}
