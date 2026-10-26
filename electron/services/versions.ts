import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { data } from './paths';
import { downloadMany, fetchJson, fileOk, type DownloadItem } from './downloader';
import { mergeVersions, resolveLibraries } from '../core/version/resolve';
import { ensureAssetIndex, ensureLogConfig, assetsRoot } from './assets';
import type { RuleContext, VersionJson, VersionManifest } from '../core/version/types';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_TTL = 10 * 60 * 1000;

export function versionsRoot(): string {
  return data('versions');
}

export function versionDir(id: string): string {
  return path.join(versionsRoot(), id);
}

let manifestCache: { at: number; data: VersionManifest } | null = null;

export function manifestFile(): string {
  return data('version_manifest_v2.json');
}

export async function getManifest(force = false): Promise<VersionManifest> {
  if (!force && manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL) return manifestCache.data;
  if (!force && fs.existsSync(manifestFile())) {
    const stat = fs.statSync(manifestFile());
    if (Date.now() - stat.mtimeMs < MANIFEST_TTL) {
      const cached = JSON.parse(fs.readFileSync(manifestFile(), 'utf8')) as VersionManifest;
      manifestCache = { at: stat.mtimeMs, data: cached };
      return cached;
    }
  }
  try {
    const fresh = await fetchJson<VersionManifest>(MANIFEST_URL);
    await fsp.mkdir(path.dirname(manifestFile()), { recursive: true });
    await fsp.writeFile(manifestFile(), JSON.stringify(fresh), 'utf8');
    manifestCache = { at: Date.now(), data: fresh };
    return fresh;
  } catch (e) {
    if (fs.existsSync(manifestFile())) {
      const cached = JSON.parse(fs.readFileSync(manifestFile(), 'utf8')) as VersionManifest;
      manifestCache = { at: Date.now(), data: cached };
      return cached;
    }
    throw e;
  }
}

export async function listVersions(includeSnapshots: boolean) {
  const manifest = await getManifest();
  const versions = manifest.versions
    .filter((v) => includeSnapshots || v.type === 'release')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
  return { latest: manifest.latest, versions };
}

export function readLocalVersion(id: string): VersionJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(versionDir(id), `${id}.json`), 'utf8')) as VersionJson;
  } catch {
    return null;
  }
}

export async function fetchVersionJson(id: string): Promise<VersionJson> {
  const local = readLocalVersion(id);
  if (local) return local;
  const manifest = await getManifest();
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Версия ${id} не найдена в манифесте Mojang`);
  const json = await fetchJson<VersionJson>(entry.url);
  await fsp.mkdir(versionDir(id), { recursive: true });
  await fsp.writeFile(path.join(versionDir(id), `${id}.json`), JSON.stringify(json, null, 2), 'utf8');
  return json;
}

export async function resolveVersion(id: string): Promise<{ json: VersionJson; baseId: string }> {
  const child = await fetchVersionJson(id);
  if (!child.inheritsFrom) return { json: child, baseId: child.id };
  const parent = await resolveVersion(child.inheritsFrom);
  return { json: mergeVersions(parent.json, child), baseId: parent.baseId };
}

export interface InstallResult {
  versionId: string;
  baseId: string;
  json: VersionJson;
  clientJar: string;
  classpath: string[];
  nativesDir: string;
  assetsRoot: string;
  assetIndexId: string;
  logConfig?: string;
}

export interface EnsureOptions {
  ctx: RuleContext;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, phase: string) => void;
}

/**
 * Клиент под именем запускаемой версии: versions/<id>/<id>.jar. Так делает
 * официальный лаунчер, и Forge/NeoForge на это рассчитывают — они исключают
 * из модулей файл «${version_name}.jar». Под именем базовой версии
 * («1.20.1.jar») клиент попадал в модули второй раз, и игра падала:
 * «Modules minecraft and _1._20._1 export package net.minecraft.data».
 */
async function clientJarFor(versionId: string, baseId: string, baseJar: string): Promise<string> {
  if (versionId === baseId) return baseJar;
  const target = path.join(versionDir(versionId), `${versionId}.jar`);
  const [src, dst] = await Promise.all([fsp.stat(baseJar), fsp.stat(target).catch(() => null)]);
  if (dst && dst.size === src.size) return target;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rm(target, { force: true });
  try {
    await fsp.link(baseJar, target);
  } catch {
    await fsp.copyFile(baseJar, target);
  }
  return target;
}

/** Гарантирует, что версия, библиотеки, нативы и ассеты скачаны. */
export async function ensureVersion(versionId: string, opts: EnsureOptions): Promise<InstallResult> {
  const { ctx, signal, onProgress } = opts;
  const { json, baseId } = await resolveVersion(versionId);
  const report = (done: number, total: number, phase: string) => onProgress?.(done, total, phase);

  // 1. Клиентский jar
  const clientJar = path.join(versionDir(baseId), `${baseId}.jar`);
  if (json.downloads?.client?.url) {
    await downloadMany(
      [{ url: json.downloads.client.url, dest: clientJar, sha1: json.downloads.client.sha1, size: json.downloads.client.size }],
      { signal, onProgress: (d, t) => report(d, t, 'Клиент игры') }
    );
  } else if (!fs.existsSync(clientJar)) {
    throw new Error(`Нет ссылки на клиент игры для версии ${baseId}`);
  }
  const launchJar = await clientJarFor(versionId, baseId, clientJar);

  // 2. Библиотеки и нативы
  const { classpath, natives } = resolveLibraries(json.libraries ?? [], ctx);
  const libRoot = data('libraries');
  const items: DownloadItem[] = [];
  for (const lib of classpath) {
    if (!lib.url) continue;
    items.push({ url: lib.url, dest: path.join(libRoot, lib.path), sha1: lib.sha1, size: lib.size });
  }
  for (const nat of natives) {
    if (!nat.url) continue;
    items.push({ url: nat.url, dest: path.join(libRoot, nat.path), sha1: nat.sha1, size: nat.size });
  }
  await downloadMany(items, {
    signal,
    concurrency: 6,
    onProgress: (d, t) => report(d, t, 'Библиотеки')
  });

  // 3. Распаковка нативов
  const nativesDir = path.join(versionDir(versionId), 'natives');
  await fsp.mkdir(nativesDir, { recursive: true });
  for (const nat of natives) {
    const jar = path.join(libRoot, nat.path);
    if (!fs.existsSync(jar)) continue;
    extractNatives(jar, nativesDir, nat.extractExclude);
  }

  // 4. Ассеты
  if (json.assetIndex) {
    await ensureAssetIndex(
      json.assetIndex.id,
      json.assetIndex.url,
      json.assetIndex.sha1,
      (d, t) => report(d, t, 'Ассеты'),
      signal
    );
  }

  // 5. Конфиг логирования (свой, с текстовым выводом)
  let logConfig: string | undefined;
  if (json.logging?.client) {
    logConfig = await ensureLogConfig('client');
  }

  return {
    versionId,
    baseId,
    json,
    clientJar: launchJar,
    classpath: [...classpath.map((l) => path.join(libRoot, l.path)), launchJar],
    nativesDir,
    assetsRoot: assetsRoot(),
    assetIndexId: json.assetIndex?.id ?? json.assets ?? 'legacy',
    logConfig
  };
}

function extractNatives(jarPath: string, dest: string, exclude: string[] = ['META-INF/']) {
  try {
    const zip = new AdmZip(jarPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (exclude.some((prefix) => entry.entryName.startsWith(prefix))) continue;
      const target = path.join(dest, path.basename(entry.entryName));
      if (fs.existsSync(target)) continue;
      fs.writeFileSync(target, entry.getData());
    }
  } catch {
    /* натив битый — повторим при следующем запуске */
  }
}

export async function isVersionInstalled(id: string): Promise<boolean> {
  const local = readLocalVersion(id);
  if (!local) return false;
  const { baseId, json } = await resolveVersion(id);
  const client = path.join(versionDir(baseId), `${baseId}.jar`);
  if (json.downloads?.client && !fs.existsSync(client)) return false;
  return true;
}

export { fileOk };