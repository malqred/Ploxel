import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { getConfig } from './config';
import { p } from './paths';
import { downloadMany } from './downloader';
import { launchOutsideApp } from './detached';

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
  // Установщик скачивается в первую очередь (впереди файлов сборок) и в
  // несколько потоков; размер и SHA-256 проверяет сам загрузчик. Старый
  // файл без хэша не используем — вдруг он неполный.
  if (!info.sha256) await fsp.rm(dest, { force: true });
  await downloadMany(
    [
      {
        url: info.url,
        dest,
        size: info.size,
        sha256: info.sha256,
        priority: 'high',
        threads: 4,
        title: `Обновление Ploxel ${info.version}`
      }
    ],
    { onProgress: () => {} }
  );
  // /S — без мастера, в ту же папку; --force-run — запустить Ploxel после установки
  // Установщик должен пережить закрытие лаунчера (иначе Electron его убьёт)
  launchOutsideApp(dest, ['/S', '--force-run']);
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
