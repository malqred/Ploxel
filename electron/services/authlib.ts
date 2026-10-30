import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { data } from './paths';
import { downloadFile } from './downloader';

/**
 * authlib-injector (MIT, github.com/yushijinhun/authlib-injector) — Java-агент,
 * который направляет вход и скины игры на Ely.by. Скачивается с официального
 * сайта проекта один раз, с проверкой SHA-256; новая версия проверяется не
 * чаще раза в неделю. Без сети — используется уже скачанный файл.
 */

const LATEST = 'https://authlib-injector.yushi.moe/artifact/latest.json';
const RECHECK_MS = 7 * 86400000;

interface Latest {
  version: string;
  download_url: string;
  checksums?: { sha256?: string };
}

interface LocalInfo {
  version: string;
  file: string;
  checkedAt: number;
}

function dir(): string {
  return data('authlib-injector');
}

function readLocal(): LocalInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir(), 'info.json'), 'utf8')) as LocalInfo;
    return fs.existsSync(path.join(dir(), info.file)) ? info : null;
  } catch {
    return null;
  }
}

/** Путь к authlib-injector.jar (скачивается при первом запуске с Ely.by). */
export async function ensureAuthlibInjector(log?: (line: string) => void): Promise<string> {
  const local = readLocal();
  if (local && Date.now() - local.checkedAt < RECHECK_MS) return path.join(dir(), local.file);

  let latest: Latest;
  try {
    const res = await fetch(LATEST, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = (await res.json()) as Latest;
    if (!latest.download_url?.startsWith('https://authlib-injector.yushi.moe/')) throw new Error('неожиданный адрес');
  } catch (e) {
    if (local) return path.join(dir(), local.file);
    throw new Error(`Не удалось скачать authlib-injector для Ely.by: ${e instanceof Error ? e.message : String(e)}`);
  }

  const file = `authlib-injector-${latest.version.replace(/[^0-9A-Za-z.-]/g, '')}.jar`;
  const dest = path.join(dir(), file);
  await fsp.mkdir(dir(), { recursive: true });
  if (!fs.existsSync(dest)) {
    log?.(`Ely.by: скачиваем authlib-injector ${latest.version}`);
    await downloadFile({ url: latest.download_url, dest, sha256: latest.checksums?.sha256 });
  }
  const info: LocalInfo = { version: latest.version, file, checkedAt: Date.now() };
  await fsp.writeFile(path.join(dir(), 'info.json'), JSON.stringify(info), 'utf8');
  // Старые версии агента больше не нужны
  for (const name of await fsp.readdir(dir())) {
    if (name.endsWith('.jar') && name !== file) await fsp.rm(path.join(dir(), name), { force: true }).catch(() => undefined);
  }
  return dest;
}
