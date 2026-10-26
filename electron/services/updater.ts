import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { getConfig } from './config';
import { p } from './paths';
import { downloadMany } from './downloader';

/**
 * Автообновление лаунчера.
 *
 * Схема простая и безопасная: вы публикуете JSON-файл (updateFeedUrl) и
 * установщик. Лаунчер сравнивает версии, скачивает установщик, проверяет
 * SHA-256 (если указан) и запускает его. Без настроенного адреса функция
 * отключается — см. BLOCKERS.md.
 */

export interface UpdateInfo {
  available: boolean;
  version: string;
  url?: string;
  sha256?: string;
  notes?: string;
  error?: string;
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const url = getConfig().updateFeedUrl;
  const current = app.getVersion();
  if (!url) {
    return {
      available: false,
      version: current,
      error: 'Автопроверка обновлений недоступна в этой сборке лаунчера. Новые версии — на странице, где вы скачали установщик.'
    };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { version: string; url?: string; sha256?: string; notes?: string };
    return {
      available: !!data.version && isNewer(data.version, current),
      version: data.version,
      url: data.url,
      sha256: data.sha256,
      notes: data.notes
    };
  } catch (e) {
    return { available: false, version: current, error: e instanceof Error ? e.message : 'Не удалось проверить обновления' };
  }
}

export async function downloadAndRunUpdate(info: UpdateInfo): Promise<string> {
  if (!info.available || !info.url) throw new Error('Обновление недоступно');
  const dest = p('downloads', `Ploxel-Setup-${info.version}.exe`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await downloadMany([{ url: info.url, dest }], { onProgress: () => {} });
  if (info.sha256) {
    const hash = await new Promise<string>((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const stream = fs.createReadStream(dest);
      stream.on('data', (c) => h.update(c));
      stream.on('error', reject);
      stream.on('end', () => resolve(h.digest('hex')));
    });
    if (hash.toLowerCase() !== info.sha256.toLowerCase()) {
      await fsp.rm(dest, { force: true });
      throw new Error('Хэш установщика не совпал — загрузка отменена');
    }
  }
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 800);
  return dest;
}