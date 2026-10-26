import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { data } from './paths';
import { downloadMany, fetchJson, fileOk } from './downloader';
import { loadSettings } from './settings';
import { javaFits } from '../../shared/java-fit';
import type { RuntimeFilesManifest, RuntimeManifest, VersionJson } from '../core/version/types';

const execFileAsync = promisify(execFile);
const RUNTIME_MANIFEST_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

export interface JavaInstall {
  path: string;
  major: number;
  source: 'system' | 'downloaded' | 'custom';
  label: string;
}

let detected: JavaInstall[] | null = null;

export function javaRoot(): string {
  return data('java');
}

function exeName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

export async function readMajor(javaPath: string): Promise<number | null> {
  try {
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], { timeout: 8000 });
    const text = `${stderr}${stdout}`;
    const m = text.match(/version "(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    const first = Number(m[1]);
    return first === 1 ? Number(m[2] ?? 0) : first;
  } catch {
    return null;
  }
}

/** Ищет Java в системе: пользовательский путь, JAVA_HOME, PATH, стандартные каталоги. */
export async function detectJava(force = false): Promise<JavaInstall[]> {
  if (detected && !force) return detected;
  const settings = loadSettings();
  const candidates: { path: string; source: JavaInstall['source']; label: string }[] = [];

  if (settings.java.customJavaPath && fs.existsSync(settings.java.customJavaPath)) {
    candidates.push({ path: settings.java.customJavaPath, source: 'custom', label: 'Выбран вручную' });
  }
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', exeName());
    if (fs.existsSync(p)) candidates.push({ path: p, source: 'system', label: 'JAVA_HOME' });
  }
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const args = process.platform === 'win32' ? ['java'] : ['java'];
    const { stdout } = await execFileAsync(which, args, { timeout: 5000 });
    for (const line of stdout.split(/\r?\n/)) {
      if (line.trim() && fs.existsSync(line.trim())) {
        candidates.push({ path: line.trim(), source: 'system', label: 'PATH' });
      }
    }
  } catch {
    /* Java в PATH нет — это нормально */
  }

  // Скачанные Mojang-рантаймы
  const root = javaRoot();
  if (fs.existsSync(root)) {
    for (const component of fs.readdirSync(root)) {
      const compDir = path.join(root, component);
      if (!fs.statSync(compDir).isDirectory()) continue;
      for (const version of fs.readdirSync(compDir)) {
        const p = path.join(compDir, version, 'bin', exeName());
        if (fs.existsSync(p)) candidates.push({ path: p, source: 'downloaded', label: `${component} ${version}` });
      }
    }
  }

  // Стандартные каталоги Windows
  if (process.platform === 'win32') {
    for (const base of [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft\\jdk',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\BellSoft'
    ]) {
      if (!fs.existsSync(base)) continue;
      for (const dir of fs.readdirSync(base)) {
        const p = path.join(base, dir, 'bin', exeName());
        if (fs.existsSync(p)) candidates.push({ path: p, source: 'system', label: dir });
      }
    }
  }

  const seen = new Set<string>();
  const out: JavaInstall[] = [];
  for (const c of candidates) {
    const key = path.resolve(c.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const major = await readMajor(c.path);
    if (major) out.push({ path: c.path, major, source: c.source, label: c.label });
  }
  out.sort((a, b) => b.major - a.major);
  detected = out;
  return out;
}

export { javaFits };

/** Выбирает подходящую Java под требуемую мажорную версию (ближайшую). */
export function pickJava(installs: JavaInstall[], required: number): JavaInstall | null {
  const suitable = installs.filter((j) => javaFits(j.major, required)).sort((a, b) => a.major - b.major);
  return suitable[0] ?? null;
}

function platformKey(): string {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux';
}

/**
 * Вариант рантайма из all.json (платформа → компонент). Если нужного компонента
 * для платформы нет, берём другой с той же или более новой мажорной версией
 * (gamma и beta — обе Java 17).
 */
export function pickRuntime(
  manifest: RuntimeManifest,
  platform: string,
  component: string
): (RuntimeManifest[string][string][number] & { component: string }) | null {
  const forPlatform = manifest[platform] ?? {};
  const direct = forPlatform[component]?.[0];
  if (direct) return { ...direct, component };
  const major = (name: string) => Number(name.match(/^(?:1\.)?(\d+)/)?.[1] ?? 0);
  const wanted = Object.values(manifest)
    .map((p) => p[component]?.[0]?.version.name)
    .find(Boolean);
  const need = wanted ? major(wanted) : 0;
  const candidates = Object.entries(forPlatform)
    .filter(([name, list]) => list.length && name.startsWith('java-runtime') && major(list[0].version.name) >= need)
    .sort((a, b) => major(a[1][0].version.name) - major(b[1][0].version.name));
  return candidates[0] ? { ...candidates[0][1][0], component: candidates[0][0] } : null;
}

/** Скачивает официальный рантайм Java от Mojang (тот же, что у официального лаунчера). */
export async function downloadJava(
  component: string,
  onProgress?: (done: number, total: number) => void
): Promise<JavaInstall> {
  const manifest = await fetchJson<RuntimeManifest>(RUNTIME_MANIFEST_URL);
  const platform = platformKey();
  const entry = pickRuntime(manifest, platform, component);
  if (!entry) throw new Error(`Mojang не предоставляет Java «${component}» для платформы ${platform}`);
  component = entry.component;
  const filesManifest = await fetchJson<RuntimeFilesManifest>(entry.manifest.url);
  const targetRoot = path.join(javaRoot(), component, entry.version.name);
  const items = [];

  for (const [rel, file] of Object.entries(filesManifest.files)) {
    if (file.type === 'directory') {
      await fsp.mkdir(path.join(targetRoot, ...rel.split('/')), { recursive: true });
      continue;
    }
    if (file.type === 'link') {
      if (process.platform !== 'win32' && file.target) {
        const link = path.join(targetRoot, ...rel.split('/'));
        await fsp.mkdir(path.dirname(link), { recursive: true });
        await fsp.rm(link, { force: true });
        await fsp.symlink(file.target, link).catch(() => undefined);
      }
      continue;
    }
    const raw = file.downloads?.raw;
    if (!raw?.url) continue;
    items.push({
      url: raw.url,
      dest: path.join(targetRoot, ...rel.split('/')),
      sha1: raw.sha1,
      size: raw.size
    });
  }
  await downloadMany(items, { concurrency: 6, onProgress });
  const javaPath = path.join(targetRoot, 'bin', exeName());
  if (!(await fileOk(javaPath))) throw new Error('Java скачана, но файл запуска не найден');
  if (process.platform !== 'win32') await fsp.chmod(javaPath, 0o755).catch(() => undefined);
  const major = (await readMajor(javaPath)) ?? 0;
  detected = null;
  return { path: javaPath, major, source: 'downloaded', label: `${component} ${entry.version.name}` };
}

export interface JavaChoice {
  java: JavaInstall;
  downloaded: boolean;
  required: number;
}

/** Гарантирует Java нужной версии: ищет локально, при отсутствии качает от Mojang. */
export async function ensureJava(
  version: VersionJson,
  opts: { allowDownload: boolean; onProgress?: (done: number, total: number) => void }
): Promise<JavaChoice> {
  const required = version.javaVersion?.majorVersion ?? 8;
  const installs = await detectJava(true);
  const suitable = installs.filter((j) => javaFits(j.major, required));
  if (suitable.length) {
    const picked = pickJava(suitable, required)!;
    return { java: picked, downloaded: false, required };
  }
  const component = version.javaVersion?.component;
  if (!opts.allowDownload || !component) {
    throw new Error(
      `Нужна Java ${required}+, подходящая не найдена. Установите Java или включите автозагрузку в настройках.`
    );
  }
  const java = await downloadJava(component, opts.onProgress);
  return { java, downloaded: true, required };
}

export function invalidateJavaCache() {
  detected = null;
}

export interface JavaRecommendation {
  required: number;
  component?: string;
  installs: JavaInstall[];
  recommendedPath?: string;
  recommendedLabel?: string;
}

/** Что нужно для версии игры и что уже подходит. */
export async function recommendJava(versionId: string): Promise<JavaRecommendation> {
  const installs = await detectJava(true);
  let required = 21;
  let component: string | undefined;
  try {
    const { resolveVersion } = await import('./versions');
    const { json } = await resolveVersion(versionId);
    required = json.javaVersion?.majorVersion ?? 8;
    component = json.javaVersion?.component;
  } catch {
    /* версия ещё не скачана — покажем общую рекомендацию */
  }
  const suitable = installs.filter((j) => javaFits(j.major, required));
  const picked = pickJava(suitable, required);
  return {
    required,
    component,
    installs,
    recommendedPath: picked?.path,
    recommendedLabel: picked ? `Java ${picked.major} · ${picked.label}` : undefined
  };
}