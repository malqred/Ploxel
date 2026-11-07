import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { data } from './paths';
import { fetchJson, downloadMany } from './downloader';
import { versionsRoot, readLocalVersion, resolveVersion } from './versions';
import { ensureJava } from './java';
import { openZipLite } from '../core/zip-lite';
import type { LoaderKind, LoaderSpec } from '../../shared/types';

/** Ход установки загрузчика для карточки загрузок: этап и счётчик. */
export type LoaderProgress = (phase: string, done: number, total: number) => void;

/** fetch с тайм-аутом: зависшее соединение не должно держать вход, загрузку или проверку бесконечно. */
const fetchT = (url: string, init: RequestInit = {}) => fetch(url, { signal: AbortSignal.timeout(20000), ...init });


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

const LOADER_HOST: Record<string, string> = {
  fabric: 'meta.fabricmc.net',
  quilt: 'meta.quiltmc.org',
  forge: 'maven.minecraftforge.net',
  neoforge: 'maven.neoforged.net'
};

/** Понятное сообщение, когда сервер загрузчика не отвечает. */
export function loaderServerError(kind: string, reason: string): string {
  const name = kind === 'neoforge' ? 'NeoForge' : kind[0].toUpperCase() + kind.slice(1);
  return `Сервер ${name} (${LOADER_HOST[kind] ?? kind}) сейчас не отвечает, поэтому загрузчик не установить. Проверьте интернет или попробуйте позже. Причина: ${reason}`;
}

/** Обращение к серверу загрузчика: сетевая ошибка превращается в понятное сообщение. */
async function viaLoaderServer<T>(kind: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    // 404 — нет такой версии загрузчика, это не «сервер не отвечает»
    if (/HTTP 404/.test(reason)) throw e;
    throw new Error(loaderServerError(kind, reason));
  }
}

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
      const xml = await (await fetchT(FORGE_METADATA)).text();
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
      const xml = await (await fetchT(NEOFORGE_METADATA)).text();
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
      // NeoForge нумеруется по версии игры без ведущей «1»: 1.21.8 → 21.8.x
      const base = gameVersion.split('.').slice(1).join('.');
      result = {
        kind,
        versions: all.filter((v) => v.startsWith(`${base}.`)).reverse()
      };
    }
  } catch (e) {
    result = { kind, versions: [], error: loaderServerError(kind, e instanceof Error ? e.message : 'не удалось получить список') };
  }
  // Ошибку сети не кэшируем: иначе после восстановления связи загрузчик полчаса «не находился»
  if (!result.error) cache.set(key, { at: Date.now(), data: result });
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
  onLog?: (line: string) => void,
  onProgress?: LoaderProgress
): Promise<InstalledLoader> {
  if (kind === 'vanilla') return { versionId: gameVersion, loader: { kind } };

  if (kind === 'fabric' || kind === 'quilt') {
    const base = kind === 'fabric' ? FABRIC : QUILT;
    const url = `${base}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
    const json = await viaLoaderServer(kind, () => fetchJson<{ id: string }>(url));
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
  // Файл версии установщик пишет в самом начале — прерванная установка его тоже оставляет.
  // Готовой считаем только законченную установку.
  if (isLoaderInstalled(versionId)) {
    return { versionId, loader: { kind, version: loaderVersion } };
  }
  const name = isNeo ? 'NeoForge' : 'Forge';
  // Названия этапов — целыми строками: так их переводит словарь интерфейса
  const phase = isNeo
    ? { installer: 'Установка NeoForge — установщик', libs: 'Установка NeoForge — библиотеки', process: 'Установка NeoForge — обработка файлов' }
    : { installer: 'Установка Forge — установщик', libs: 'Установка Forge — библиотеки', process: 'Установка Forge — обработка файлов' };

  const installerUrl = isNeo
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
    : `${FORGE_MAVEN}/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`;
  const installer = data('installers', `${kind}-${loaderVersion}.jar`);
  onLog?.(`Скачивание установщика ${kind}…`);
  onProgress?.(phase.installer, 0, 1);
  await viaLoaderServer(kind, () => downloadMany([{ url: installerUrl, dest: installer }], { onProgress: () => {} }));

  // Библиотеки качаем сами, параллельно и с повторами. Установщик Forge берёт их по одной
  // и сначала идёт на зеркало, которое часто не отвечает: 40 тайм-аутов — минуты простоя.
  // Готовые файлы с верной контрольной суммой установщик пропускает.
  const plan = readInstallerPlan(installer);
  const libs = plan.libraries.filter((l) => !fs.existsSync(data('libraries', l.path)));
  if (libs.length) {
    onLog?.(`Библиотеки ${name}: ${libs.length}`);
    await downloadMany(
      libs.map((l) => ({ url: l.url, dest: data('libraries', l.path), sha1: l.sha1, size: l.size })),
      { onProgress: (done, total) => onProgress?.(phase.libs, done, total) }
    ).catch((e) => onLog?.(`Не все библиотеки скачались заранее — установщик докачает сам: ${e instanceof Error ? e.message : e}`));
  }

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
  // Обработка файлов игры: каждый шаг установщик отделяет строкой из «=»
  let step = 0;
  onProgress?.(phase.process, 0, plan.processors);
  await runInstaller(java.path, installer, installRoot, (line) => {
    onLog?.(line);
    if (/^={20,}$/.test(line) && plan.processors > 0) {
      step = Math.min(step + 1, plan.processors);
      onProgress?.(phase.process, step, plan.processors);
    }
  });
  if (!readLocalVersion(versionId)) {
    throw new Error(`Установщик ${kind} завершился, но версия ${versionId} не появилась`);
  }
  await fsp.writeFile(completeMarker(versionId), new Date().toISOString(), 'utf8').catch(() => undefined);
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
  if (!fs.existsSync(path.join(versionsRoot(), versionId, `${versionId}.json`))) return false;
  return isForgeFamily(versionId) ? isForgeInstallComplete(versionId) : true;
}

const isForgeFamily = (versionId: string) => /-forge-|^neoforge-/.test(versionId);
const completeMarker = (versionId: string) => path.join(versionsRoot(), versionId, '.ploxel-complete');

/**
 * Forge/NeoForge установлен до конца: есть наша отметка, а для установок из прошлых
 * версий лаунчера — собранный установщиком client.jar (его делает последний шаг).
 * Forge до 1.13 шагов обработки не имеет — достаточно файла версии.
 */
export function isForgeInstallComplete(versionId: string): boolean {
  if (fs.existsSync(completeMarker(versionId))) return true;
  const neo = versionId.match(/^neoforge-(.+)$/);
  if (neo) return fs.existsSync(data('libraries', 'net', 'neoforged', 'neoforge', neo[1], `neoforge-${neo[1]}-client.jar`));
  const forge = versionId.match(/^(.+)-forge-(.+)$/);
  if (!forge) return true;
  const [, mc, v] = forge;
  const minor = Number(mc.split('.')[1] ?? 0);
  if (mc.startsWith('1.') && minor < 13) return true;
  return fs.existsSync(data('libraries', 'net', 'minecraftforge', 'forge', `${mc}-${v}`, `forge-${mc}-${v}-client.jar`));
}

interface InstallerLib {
  path: string;
  url: string;
  sha1?: string;
  size?: number;
}

/**
 * Что установщик Forge/NeoForge будет качать и сколько шагов обработки сделает:
 * библиотеки из install_profile.json и version.json внутри установщика.
 */
export function readInstallerPlan(installerJar: string): { libraries: InstallerLib[]; processors: number } {
  try {
    const zip = openZipLite(installerJar);
    try {
      const read = (name: string) => {
        const entry = zip.entries.find((e) => e.name === name);
        return entry ? JSON.parse(zip.read(entry).toString('utf8')) : null;
      };
      const profile = read('install_profile.json') ?? {};
      const version = read('version.json') ?? {};
      const libs = new Map<string, InstallerLib>();
      for (const lib of [...(profile.libraries ?? []), ...(version.libraries ?? [])]) {
        const a = lib?.downloads?.artifact;
        // Без адреса — файл лежит внутри установщика, качать нечего
        if (!a?.path || !a.url) continue;
        libs.set(a.path, { path: a.path, url: a.url, sha1: a.sha1, size: a.size || undefined });
      }
      const processors = (profile.processors ?? []).filter((p: { sides?: string[] }) => !p.sides || p.sides.includes('client')).length;
      return { libraries: [...libs.values()], processors };
    } finally {
      zip.close();
    }
  } catch {
    return { libraries: [], processors: 0 };
  }
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
  onLog?: (line: string) => void,
  onProgress?: LoaderProgress
): Promise<{ versionId: string; loader: LoaderSpec; changed: boolean }> {
  if (loader.kind === 'vanilla') return { versionId: gameVersion, loader, changed: false };
  let version = loader.version;
  if (!version) {
    const list = await listLoaderVersions(loader.kind, gameVersion);
    version = list.versions[0];
    // Пустой список из-за сети — это не «версий нет»: говорим, что сервер не ответил
    if (!version && list.error) throw new Error(list.error);
    if (!version) throw new Error(`Для Minecraft ${gameVersion} не нашлось версий ${loader.kind}. Выберите другой загрузчик в настройках сборки.`);
    onLog?.(`Версия ${loader.kind} не указана — выбрана последняя: ${version}`);
  }
  const spec: LoaderSpec = { kind: loader.kind, version };
  const versionId = await versionIdFor(gameVersion, spec);
  if (isLoaderInstalled(versionId)) return { versionId, loader: spec, changed: version !== loader.version };
  onLog?.(`Установка ${loader.kind} ${version}…`);
  const installed = await installLoader(gameVersion, loader.kind, version, onLog, onProgress);
  return { versionId: installed.versionId, loader: spec, changed: version !== loader.version };
}
