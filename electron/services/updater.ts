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
 * Автообновление лаунчера через GitHub Releases (github.com/malqred/Ploxel).
 *
 * Лаунчер берёт список релизов (бета-версии тоже), находит самый новый с
 * установщиком Ploxel-Setup-*.exe, сравнивает версию с текущей, скачивает
 * установщик, сверяет SHA-256, которую GitHub считает сам, и запускает его.
 * В config.json можно указать свой updateFeedUrl (JSON: version, url, sha256).
 */

export const UPDATE_REPO = 'malqred/Ploxel';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}
interface GitHubRelease {
  tag_name: string;
  name?: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: GitHubAsset[];
}

/** Самый новый релиз с установщиком для Windows (черновики пропускаются). */
export function pickRelease(releases: GitHubRelease[]): { version: string; release: GitHubRelease; asset: GitHubAsset } | null {
  let best: { version: string; release: GitHubRelease; asset: GitHubAsset } | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const asset = release.assets.find((a) => /^Ploxel-Setup-[\w.-]+\.exe$/i.test(a.name));
    if (!asset) continue;
    const version = release.tag_name.replace(/^v/i, '');
    if (!best || isNewer(version, best.version)) best = { version, release, asset };
  }
  return best;
}

export interface UpdateInfo {
  available: boolean;
  version: string;
  url?: string;
  sha256?: string;
  notes?: string;
  /** страница релиза на GitHub */
  page?: string;
  size?: number;
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
  if (!url) return checkGitHub(current);
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
  // /S — без мастера, в ту же папку; --force-run — запустить Ploxel после установки
  spawn(dest, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 800);
  return dest;
}
async function checkGitHub(current: string): Promise<UpdateInfo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=15`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Ploxel/${current}` },
      signal: AbortSignal.timeout(15000)
    });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub временно ограничил запросы — попробуйте через час.');
    if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
    const picked = pickRelease((await res.json()) as GitHubRelease[]);
    if (!picked) return { available: false, version: current };
    const sha = picked.asset.digest?.startsWith('sha256:') ? picked.asset.digest.slice(7) : undefined;
    return {
      available: isNewer(picked.version, current),
      version: picked.version,
      url: picked.asset.browser_download_url,
      sha256: sha,
      size: picked.asset.size,
      notes: (picked.release.body ?? '').trim().slice(0, 4000) || undefined,
      page: picked.release.html_url
    };
  } catch (e) {
    return {
      available: false,
      version: current,
      error: `Не удалось проверить обновления: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}
