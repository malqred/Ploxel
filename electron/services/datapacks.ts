// Датапаки: zip-файлы и папки в saves/<мир>/datapacks. Ставятся в конкретный
// мир, а не в сборку. Откуда пришёл файл (каталог, проект, версия) хранится в
// .ploxel-datapacks.json в папке сборки — в папке мира игра видела бы лишний файл.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { instanceDir } from './paths';
import { readInstance } from './instances';
import { worldFolder } from './worlds';
import { downloadFile } from './downloader';
import { catalogProject, catalogVersions } from './catalog';
import { openZipLite } from '../core/zip-lite';
import { packDescription } from '../core/pack-meta';
import type { CatalogVersion, DatapackInfo } from '../../shared/types';

type Source = 'modrinth' | 'curseforge';
interface StoredMeta {
  source: Source;
  projectId: string;
  versionId?: string;
  version?: string;
  name: string;
  iconUrl?: string;
}
/** мир → имя файла → откуда он */
type MetaFile = Record<string, Record<string, StoredMeta>>;

const DISABLED = '.disabled';

function metaPath(instanceId: string): string {
  return path.join(instanceDir(instanceId), '.ploxel-datapacks.json');
}

function readMeta(instanceId: string): MetaFile {
  try {
    return JSON.parse(fs.readFileSync(metaPath(instanceId), 'utf8')) as MetaFile;
  } catch {
    return {};
  }
}

async function writeMeta(instanceId: string, meta: MetaFile): Promise<void> {
  await fsp.writeFile(metaPath(instanceId), JSON.stringify(meta, null, 2), 'utf8');
}

export function datapacksDir(instanceId: string, world: string): string {
  return path.join(worldFolder(instanceId, world), 'datapacks');
}

/** Имя записи в папке datapacks без пути и выхода наружу. */
function entryPath(instanceId: string, world: string, fileName: string): string {
  const base = path.basename(fileName);
  if (!base || base !== fileName || base === '.' || base === '..') throw new Error('Неверное имя датапака');
  return path.join(datapacksDir(instanceId, world), base);
}

function readDescription(file: string, isFolder: boolean): string {
  try {
    if (isFolder) return packDescription(fs.readFileSync(path.join(file, 'pack.mcmeta'), 'utf8'));
    const zip = openZipLite(file);
    try {
      const entry = zip.entries.find((e) => e.name === 'pack.mcmeta');
      return entry ? packDescription(zip.read(entry).toString('utf8')) : '';
    } finally {
      zip.close();
    }
  } catch {
    return '';
  }
}

function folderSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(full) : fs.statSync(full).size;
  }
  return total;
}

export function listDatapacks(instanceId: string, world: string): DatapackInfo[] {
  const dir = datapacksDir(instanceId, world);
  if (!fs.existsSync(dir)) return [];
  const meta = readMeta(instanceId)[world] ?? {};
  const out: DatapackInfo[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const enabled = !entry.name.endsWith(DISABLED);
    const fileName = enabled ? entry.name : entry.name.slice(0, -DISABLED.length);
    const full = path.join(dir, entry.name);
    const isFolder = entry.isDirectory();
    // Игра читает только папки с pack.mcmeta и zip-архивы
    if (isFolder ? !fs.existsSync(path.join(full, 'pack.mcmeta')) : !fileName.toLowerCase().endsWith('.zip')) continue;
    const stored = meta[fileName];
    out.push({
      fileName,
      name: stored?.name ?? fileName.replace(/\.zip$/i, ''),
      description: readDescription(full, isFolder) || undefined,
      enabled,
      isFolder,
      sizeBytes: isFolder ? folderSize(full) : fs.statSync(full).size,
      source: stored?.source ?? 'local',
      projectId: stored?.projectId,
      versionId: stored?.versionId,
      version: stored?.version,
      iconUrl: stored?.iconUrl
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Ставит датапак из каталога в мир: версия под версию игры сборки, старый файл
 * того же проекта убирается (иначе игра загрузит обе версии).
 */
export async function installDatapack(
  instanceId: string,
  world: string,
  source: Source,
  projectId: string,
  opts: { versionId?: string; name?: string; iconUrl?: string } = {}
): Promise<DatapackInfo> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const versions = await catalogVersions(source, projectId, instance.gameVersion, 'datapack');
  const version: CatalogVersion | undefined = opts.versionId ? versions.find((v) => v.id === opts.versionId) : versions[0];
  if (!version) throw new Error(`Нет версии датапака для Minecraft ${instance.gameVersion}`);
  const file = version.files.find((f) => f.primary && f.fileName.toLowerCase().endsWith('.zip')) ??
    version.files.find((f) => f.fileName.toLowerCase().endsWith('.zip'));
  if (!file) {
    throw new Error(
      version.files.length
        ? 'У этой версии нет zip-архива датапака — возможно, это версия-мод. Выберите другую версию.'
        : 'Автор запретил скачивание через сторонние лаунчеры. Скачайте архив на странице проекта и добавьте его кнопкой «Добавить файлы».'
    );
  }

  const dir = datapacksDir(instanceId, world);
  await fsp.mkdir(dir, { recursive: true });
  const target = entryPath(instanceId, world, file.fileName);
  const tmp = `${target}.download`;
  await downloadFile({ url: file.url, dest: tmp, sha1: file.hashes?.sha1, size: file.size });

  const meta = readMeta(instanceId);
  const worldMeta = (meta[world] ??= {});
  // Прошлая версия того же проекта: выключенная остаётся выключенной
  let wasDisabled = false;
  for (const [name, m] of Object.entries(worldMeta)) {
    if (m.projectId !== projectId || m.source !== source) continue;
    wasDisabled ||= fs.existsSync(path.join(dir, name + DISABLED));
    if (name !== file.fileName) {
      await fsp.rm(path.join(dir, name), { force: true, recursive: true });
      await fsp.rm(path.join(dir, name + DISABLED), { force: true, recursive: true });
    }
    delete worldMeta[name];
  }
  await fsp.rm(target, { force: true });
  await fsp.rm(target + DISABLED, { force: true });
  await fsp.rename(tmp, wasDisabled ? target + DISABLED : target);

  const info = opts.name ? null : await catalogProject(source, projectId).catch(() => null);
  worldMeta[file.fileName] = {
    source,
    projectId,
    versionId: version.id,
    version: version.versionNumber,
    name: opts.name ?? info?.title ?? file.fileName.replace(/\.zip$/i, ''),
    iconUrl: opts.iconUrl ?? info?.iconUrl
  };
  await writeMeta(instanceId, meta);
  const installed = listDatapacks(instanceId, world).find((d) => d.fileName === file.fileName);
  if (!installed) throw new Error('Датапак скачан, но не найден в папке мира');
  return installed;
}

/** Свои zip-архивы датапаков в мир; возвращает, сколько добавлено. */
export async function addDatapackFiles(instanceId: string, world: string, files: string[]): Promise<number> {
  const dir = datapacksDir(instanceId, world);
  await fsp.mkdir(dir, { recursive: true });
  let added = 0;
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.zip') || !fs.existsSync(file)) continue;
    await fsp.copyFile(file, entryPath(instanceId, world, path.basename(file)));
    added++;
  }
  return added;
}

export async function setDatapackEnabled(instanceId: string, world: string, fileName: string, enabled: boolean): Promise<void> {
  const active = entryPath(instanceId, world, fileName);
  const disabled = active + DISABLED;
  if (enabled && fs.existsSync(disabled)) await fsp.rename(disabled, active);
  if (!enabled && fs.existsSync(active)) await fsp.rename(active, disabled);
}

export async function removeDatapack(instanceId: string, world: string, fileName: string): Promise<void> {
  const active = entryPath(instanceId, world, fileName);
  await fsp.rm(active, { force: true, recursive: true });
  await fsp.rm(active + DISABLED, { force: true, recursive: true });
  const meta = readMeta(instanceId);
  if (meta[world]?.[fileName]) {
    delete meta[world][fileName];
    await writeMeta(instanceId, meta);
  }
}
