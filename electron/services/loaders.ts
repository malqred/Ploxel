import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { data } from './paths';
import { fetchJson, downloadMany } from './downloader';
import { versionsRoot, readLocalVersion, resolveVersion } from './versions';
import { ensureJava } from './java';
import type { LoaderKind, LoaderSpec } from '../../shared/types';

const FABRIC = 'https://meta.fabricmc.net/v2';
const QUILT = 'https://meta.quiltmc.org/v3';
const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const NEOFORGE_METADATA = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';

export interface LoaderVersions {
  kind: LoaderKind;
  versions: string[];
  error?: string;
}

const cache = new Map<string, { at: number; data: LoaderVersions }>();

/** Список доступных версий загрузчика для конкретной версии игры. */
export async function listLoaderVersions(kind: LoaderKind, gameVersion: string): Promise<LoaderVersions> {
  const key = `${kind}:${gameVersion}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;

  let result: LoaderVersions;
  try {
    if (kind === 'vanilla') {
      result = { kind, versions: [] };
    } else if (kind === 'fabric') {
      const list = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(
        `${FABRIC}/versions/loader/${encodeURIComponent(gameVersion)}`
      );
      result = { kind, versions: list.map((v) => v.loader.version) };
    } else if (kind === 'quilt') {
      const list = await fetchJson<{ loader: { version: string } }[]>(
        `${QUILT}/versions/loader/${encodeURIComponent(gameVersion)}`
      );
      result = { kind, versions: list.map((v) => v.loader.version) };
    } else if (kind === 'forge') {
      const xml = await (await fetch(FORGE_METADATA)).text();
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
      const prefix = `${gameVersion}-`;
      result = {
        kind,
        versions: all
          .filter((v) => v.startsWith(prefix))
          .map((v) => v.slice(prefix.length))
          .reverse()
      };
    } else {
      const xml = await (await fetch(NEOFORGE_METADATA)).text();
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
      // NeoForge нумеруется по версии игры без ведущей «1»: 1.21.8 → 21.8.x
      const base = gameVersion.split('.').slice(1).join('.');
      result = {
        kind,
        versions: all.filter((v) => v.startsWith(`${base}.`)).reverse()
      };
    }
  } catch (e) {
    result = { kind, versions: [], error: e instanceof Error ? e.message : 'Не удалось получить список' };
  }
  cache.set(key, { at: Date.now(), data: result });
  return result;
}

export interface InstalledLoader {
  versionId: string;
  loader: LoaderSpec;
}

/** Ставит загрузчик и возвращает id версии, которую надо запускать. */
export async function installLoader(
  gameVersion: string,
  kind: LoaderKind,
  loaderVersion: string,
  onLog?: (line: string) => void
): Promise<InstalledLoader> {
  if (kind === 'vanilla') return { versionId: gameVersion, loader: { kind } };

  if (kind === 'fabric' || kind === 'quilt') {
    const base = kind === 'fabric' ? FABRIC : QUILT;
    const url = `${base}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
    const json = await fetchJson<{ id: string }>(url);
    const dir = path.join(versionsRoot(), json.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${json.id}.json`), JSON.stringify(json, null, 2), 'utf8');
    onLog?.(`Загрузчик ${kind} ${loaderVersion} установлен`);
    return { versionId: json.id, loader: { kind, version: loaderVersion } };
  }

  // Forge / NeoForge — официальный установщик в режиме --installClient
  const isNeo = kind === 'neoforge';
  const versionId = isNeo
    ? `neoforge-${loaderVersion}`
    : `${gameVersion}-forge-${loaderVersion}`;
  if (readLocalVersion(versionId)) {
    return { versionId, loader: { kind, version: loaderVersion } };
  }

  const installerUrl = isNeo
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
    : `${FORGE_MAVEN}/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`;
  const installer = data('installers', `${kind}-${loaderVersion}.jar`);
  onLog?.(`Скачивание установщика ${kind}…`);
  await downloadMany([{ url: installerUrl, dest: installer }], { onProgress: () => {} });

  // Java — та, что нужна самой версии игры (Java 25 ломает установщик Forge 1.20.1,
  // Java 17 — Forge 1.12.2); если подходящей нет, скачиваем официальную
  const { json: base } = await resolveVersion(gameVersion);
  const { java } = await ensureJava(base, { allowDownload: true, onProgress: () => {} });

  // Установщик пишет в versions/ и libraries/ — это папка data, а не корень данных.
  // Без launcher_profiles.json он отказывается работать («run the launcher first»).
  const installRoot = data();
  const profiles = path.join(installRoot, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) {
    await fsp.mkdir(installRoot, { recursive: true });
    await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2), 'utf8');
  }

  onLog?.(`Запуск установщика ${kind}…`);
  await runInstaller(java.path, installer, installRoot, onLog);
  if (!readLocalVersion(versionId)) {
    throw new Error(`Установщик ${kind} завершился, но версия ${versionId} не появилась`);
  }
  return { versionId, loader: { kind, version: loaderVersion } };
}

function runInstaller(javaPath: string, installer: string, installRoot: string, onLog?: (line: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', installer, '--installClient', installRoot], {
      cwd: path.dirname(installer),
      windowsHide: true
    });
    let output = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      output += text;
      for (const line of text.split(/\r?\n/)) if (line.trim()) onLog?.(line.trim());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Установщик завершился с кодом ${code}. ${output.slice(-400)}`));
    });
  });
}

/** Возвращает id версии, которую нужно запускать для сборки. */
export async function versionIdFor(gameVersion: string, loader: LoaderSpec): Promise<string> {
  if (loader.kind === 'vanilla' || !loader.version) return gameVersion;
  if (loader.kind === 'neoforge') return `neoforge-${loader.version}`;
  if (loader.kind === 'forge') return `${gameVersion}-forge-${loader.version}`;
  const prefix = loader.kind === 'fabric' ? 'fabric-loader' : 'quilt-loader';
  const expected = `${prefix}-${loader.version}-${gameVersion}`;
  if (isLoaderInstalled(expected)) return expected;
  const existing = (await safeReadVersions()).find(
    (id) => id.startsWith(prefix) && id.endsWith(`-${gameVersion}`) && id.includes(`-${loader.version}-`)
  );
  return existing ?? expected;
}

async function safeReadVersions(): Promise<string[]> {
  try {
    return await fsp.readdir(versionsRoot());
  } catch {
    return [];
  }
}

export async function ensureVersionJson(versionId: string): Promise<void> {
  await resolveVersion(versionId);
}
export function isLoaderInstalled(versionId: string): boolean {
  return fs.existsSync(path.join(versionsRoot(), versionId, `${versionId}.json`));
}
/**
 * Загрузчик сборки перед запуском: если его файлов нет (импорт из другого
 * лаунчера, перенос папки данных) — устанавливаем. Если версия загрузчика
 * неизвестна — берём последнюю для этой версии игры, а не запускаем молча
 * чистую игру без модов.
 */
export async function ensureLoader(
  gameVersion: string,
  loader: LoaderSpec,
  onLog?: (line: string) => void
): Promise<{ versionId: string; loader: LoaderSpec; changed: boolean }> {
  if (loader.kind === 'vanilla') return { versionId: gameVersion, loader, changed: false };
  let version = loader.version;
  if (!version) {
    const list = await listLoaderVersions(loader.kind, gameVersion);
    version = list.versions[0];
    if (!version) throw new Error(`Для Minecraft ${gameVersion} не нашлось версий ${loader.kind}. Выберите другой загрузчик в настройках сборки.`);
    onLog?.(`Версия ${loader.kind} не указана — выбрана последняя: ${version}`);
  }
  const spec: LoaderSpec = { kind: loader.kind, version };
  const versionId = await versionIdFor(gameVersion, spec);
  if (isLoaderInstalled(versionId)) return { versionId, loader: spec, changed: version !== loader.version };
  onLog?.(`Установка ${loader.kind} ${version}…`);
  const installed = await installLoader(gameVersion, loader.kind, version, onLog);
  return { versionId: installed.versionId, loader: spec, changed: version !== loader.version };
}
