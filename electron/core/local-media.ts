import path from 'node:path';

const IMAGE = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const VIDEO = ['.mp4', '.webm', '.mov', '.m4v'];

/** Картинка, видео или неподходящий файл — по расширению. */
export function mediaKindOf(file: string): 'image' | 'video' | null {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE.includes(ext)) return 'image';
  if (VIDEO.includes(ext)) return 'video';
  return null;
}

/** Имя файла или папки без путей и подвохов («..», «C:», разделители). */
function safeName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\\/:*?"<>|\0]/.test(name);
}

/**
 * Путь к файлу по адресу ploxel-media://<area>/<...>. Отдаём только свои
 * папки: bg/<файл> — backgrounds, shot/<сборка>/<файл> — снимки сборки.
 * Всё остальное (в том числе попытки выйти через «..») — null.
 */
export function resolveMediaPath(root: string, area: string, pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.every(safeName)) return null;
  let file: string | null = null;
  if (area === 'bg' && parts.length === 1) file = path.join(root, 'backgrounds', parts[0]);
  if (area === 'shot' && parts.length === 2) file = path.join(root, 'instances', parts[0], 'screenshots', parts[1]);
  if (!file || !mediaKindOf(file)) return null;
  const base = path.resolve(root);
  const resolved = path.resolve(file);
  return resolved.startsWith(base + path.sep) ? resolved : null;
}
