import fs from 'node:fs';
import { getCurseForgeFileDownloads, hasCurseForgeKey } from './curseforge';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { instanceDir, p } from './paths';
import { createInstance, deleteInstance, readInstance, writeInstance } from './instances';
import { scanMods } from './mods';
import { downloadMany } from './downloader';
import { installLoader } from './loaders';
import { catalogVersions } from './catalog';
import type { Instance, LoaderKind, LoaderSpec } from '../../shared/types';

interface MrpackIndex {
  formatVersion: number;
  name: string;
  versionId: string;
  files: { path: string; hashes: { sha1?: string }; downloads: string[]; fileSize?: number; env?: { client?: string } }[];
  dependencies: Record<string, string>;
}

function loaderFromDependencies(deps: Record<string, string>): LoaderSpec {
  if (deps['fabric-loader']) return { kind: 'fabric', version: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { kind: 'quilt', version: deps['quilt-loader'] };
  if (deps['neoforge']) return { kind: 'neoforge', version: deps['neoforge'] };
  if (deps['forge']) return { kind: 'forge', version: deps['forge'] };
  return { kind: 'vanilla' };
}

function safeJoin(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  if (!target.startsWith(path.resolve(root))) throw new Error(`Небезопасный путь в архиве: ${rel}`);
  return target;
}

function extractDir(zip: AdmZip, prefix: string, targetRoot: string) {
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith(prefix) || entry.isDirectory) continue;
    const rel = entry.entryName.slice(prefix.length);
    if (!rel) continue;
    const target = safeJoin(targetRoot, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
}

export interface ModpackInstallProgress {
  (phase: string, done: number, total: number): void;
}

/** Установка модпака Modrinth (.mrpack). */
export async function installMrpack(
  file: string,
  onProgress: ModpackInstallProgress,
  signal?: AbortSignal
): Promise<Instance> {
  const zip = new AdmZip(file);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('В архиве нет modrinth.index.json — это не модпак Modrinth');
  const index = JSON.parse(indexEntry.getData().toString('utf8')) as MrpackIndex;

  const gameVersion = index.dependencies.minecraft;
  const loader = loaderFromDependencies(index.dependencies);
  onProgress('Создание сборки', 0, 1);
  const instance = await createInstance({
    name: index.name || path.basename(file, '.mrpack'),
    gameVersion,
    loader,
    source: { kind: 'modrinth' }
  });
  return withCleanup(instance, async () => {
    if (loader.kind !== 'vanilla' && loader.version) {
      onProgress(`Установка ${loader.kind}`, 0, 1);
      await installLoader(gameVersion, loader.kind as LoaderKind, loader.version);
    }

    const items = index.files
      .filter((f) => f.env?.client !== 'unsupported' && f.downloads[0])
      .map((f) => ({
        url: f.downloads[0],
        dest: safeJoin(instanceDir(instance.id), f.path),
        sha1: f.hashes.sha1,
        size: f.fileSize
      }));
    await downloadMany(items, {
      signal,
      concurrency: 5,
      onProgress: (d, t) => onProgress('Файлы модпака', d, t)
    });

    onProgress('Распаковка настроек', 0, 1);
    extractDir(zip, 'overrides/', instanceDir(instance.id));
    extractDir(zip, 'client-overrides/', instanceDir(instance.id));
    await fetchCurseForgeOnlyMods(instanceDir(instance.id), signal);
    return instance;
  });
}

/**
 * Модпаки Modrinth (Better MC и др.) не могут включить моды, которые есть только
 * на CurseForge, и перечисляют их в config/missing_mods_checker.json — при
 * запуске мод Missing Mods Checker открывает окно со ссылками. Если задан ключ
 * CurseForge, скачиваем эти файлы сами; что не скачалось (автор запретил
 * сторонние загрузки) — так и останется в окне со ссылками.
 */
async function fetchCurseForgeOnlyMods(dir: string, signal?: AbortSignal): Promise<void> {
  const listFile = path.join(dir, 'config', 'missing_mods_checker.json');
  if (!fs.existsSync(listFile) || !hasCurseForgeKey()) return;
  let list: { pattern?: string; url?: string; destination?: string }[];
  try {
    list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  const wanted = list
    .map((e) => ({ rel: `${e.destination || 'mods'}/${e.pattern ?? ''}`, id: Number(e.url?.match(/\/download\/(\d+)/)?.[1]), pattern: e.pattern }))
    .filter((w) => w.pattern && Number.isFinite(w.id) && !fs.existsSync(safeJoin(dir, w.rel)));
  if (!wanted.length) return;
  const info = await getCurseForgeFileDownloads(wanted.map((w) => w.id)).catch(() => ({}) as Record<number, never>);
  const items = wanted
    .filter((w) => info[w.id]?.downloadUrl)
    .map((w) => ({ url: info[w.id].downloadUrl!, dest: safeJoin(dir, w.rel), sha1: info[w.id].sha1, size: info[w.id].size }));
  await downloadMany(items, { signal, concurrency: 3 }).catch(() => undefined);
}

/**
 * Если установка модпака оборвалась (сеть, загрузчик, Java), недоделанная
 * сборка удаляется — иначе после каждой попытки в списке оставался мусор.
 */
async function withCleanup(instance: Instance, fn: () => Promise<Instance>): Promise<Instance> {
  try {
    return await fn();
  } catch (e) {
    await deleteInstance(instance.id).catch(() => undefined);
    throw e;
  }
}

/** Установка модпака CurseForge (zip с manifest.json). */
export async function installCurseForgePack(
  file: string,
  onProgress: ModpackInstallProgress,
  signal?: AbortSignal
): Promise<Instance> {
  const zip = new AdmZip(file);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('В архиве нет manifest.json — это не модпак CurseForge');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as {
    name: string;
    version: string;
    minecraft: { version: string; modLoaders: { id: string; primary: boolean }[] };
    files: { projectID: number; fileID: number; required: boolean }[];
    overrides: string;
  };

  const primary = manifest.minecraft.modLoaders.find((m) => m.primary) ?? manifest.minecraft.modLoaders[0];
  let loader: LoaderSpec = { kind: 'vanilla' };
  if (primary) {
    const [loaderName, ...rest] = primary.id.split('-');
    const ver = rest.join('-');
    if (loaderName === 'forge') loader = { kind: 'forge', version: ver };
    else if (loaderName === 'neoforge') loader = { kind: 'neoforge', version: ver };
    else if (loaderName === 'fabric') loader = { kind: 'fabric', version: ver };
    else if (loaderName === 'quilt') loader = { kind: 'quilt', version: ver };
  }

  // Ключ проверяем до создания сборки, иначе после ошибки оставалась пустая сборка
  const key = hasCurseForgeKey();
  if (!key) throw new Error('Модпаки CurseForge устанавливаются через каталог CurseForge, а он сейчас недоступен: не задан ключ CurseForge (Настройки → Общие).');
  const instance = await createInstance({
    name: manifest.name,
    gameVersion: manifest.minecraft.version,
    loader,
    source: { kind: 'curseforge' }
  });
  return withCleanup(instance, async () => {
    if (loader.kind !== 'vanilla' && loader.version) {
      onProgress(`Установка ${loader.kind}`, 0, 1);
      await installLoader(manifest.minecraft.version, loader.kind as LoaderKind, loader.version);
    }

    const modsDir = path.join(instanceDir(instance.id), 'mods');
    await fsp.mkdir(modsDir, { recursive: true });
    const items = [];
    const manual: string[] = [];
    onProgress('Файлы модпака', 0, manifest.files.length);
    // Сведения о файлах — пачками по 100 одним запросом
    const files = await getCurseForgeFileDownloads(manifest.files.map((f) => f.fileID));
    for (const f of manifest.files) {
      const info = files[f.fileID];
      if (!info) {
        manual.push(`https://www.curseforge.com/projects/${f.projectID} (файл ${f.fileID})`);
        continue;
      }
      // Автор запретил сторонние загрузки — файл скачивается только с сайта
      if (!info.downloadUrl) {
        manual.push(`${info.fileName}: https://www.curseforge.com/projects/${f.projectID}`);
        continue;
      }
      items.push({ url: info.downloadUrl, dest: path.join(modsDir, info.fileName), sha1: info.sha1, size: info.size });
    }
    await downloadMany(items, { signal, concurrency: 3, onProgress: (d, t) => onProgress('Файлы модпака', d, t) });

    const overrides = manifest.overrides || 'overrides';
    extractDir(zip, `${overrides}/`, instanceDir(instance.id));
    if (manual.length) {
      await fsp.writeFile(
        path.join(instanceDir(instance.id), 'СКАЧАТЬ ВРУЧНУЮ.txt'),
        [
          'Эти файлы автор модпака разрешил скачивать только с сайта CurseForge.',
          'Скачайте их и положите в папку mods этой сборки:',
          '',
          ...manual,
          ''
        ].join('\r\n'),
        'utf8'
      );
    }
    return instance;
  });
}

/** Автоопределение формата архива модпака. */
export async function installModpackArchive(file: string, onProgress: ModpackInstallProgress): Promise<Instance> {
  const zip = new AdmZip(file);
  if (zip.getEntry('modrinth.index.json')) return installMrpack(file, onProgress);
  if (zip.getEntry('manifest.json')) return installCurseForgePack(file, onProgress);
  throw new Error('Неизвестный формат модпака: ожидается .mrpack или zip с manifest.json');
}

/** Установка модпака прямо из каталога. */
export async function installModpackFromProject(
  source: 'modrinth' | 'curseforge',
  projectId: string,
  versionId?: string
): Promise<Instance> {
  const versions = await catalogVersions(source, projectId);
  const target = versions.find((v) => v.id === versionId) ?? versions[0];
  if (!target) throw new Error('Нет доступных версий модпака');
  const file = target.files.find((f) => f.primary && f.fileName.endsWith('.mrpack')) ?? target.files[0];
  if (!file) throw new Error('У модпака нет файла для скачивания');
  const dest = p('downloads', file.fileName);
  await downloadMany([{ url: file.url, dest, sha1: file.hashes?.sha1, size: file.size }], {
    onProgress: () => {}
  });
  const instance = await installModpackArchive(dest, () => {});
  await writeInstance({ ...instance, source: { kind: source, projectId, versionId: target.id } });
  return instance;
}

/**
 * Экспорт сборки в .mrpack.
 * Файлы, установленные из Modrinth, описываются ссылками; локальные —
 * кладутся в overrides, чтобы архив оставался рабочим без внешних ссылок.
 */
export async function exportMrpack(instanceId: string, targetFile: string): Promise<string> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const zip = new AdmZip();
  const mods = scanMods(instanceId);
  const files: MrpackIndex['files'] = [];
  const overrides: string[] = [];

  for (const mod of mods) {
    const rel = `${mod.kind === 'mod' ? 'mods' : mod.kind === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'}/${mod.fileName}`;
    const abs = path.join(instanceDir(instanceId), rel);
    if (!fs.existsSync(abs)) continue;
    if (mod.source === 'modrinth' && mod.sha1) {
      const { getModrinthVersionByHash } = await import('./modrinth');
      const v = await getModrinthVersionByHash(mod.sha1).catch(() => null);
      if (v?.files[0]) {
        files.push({
          path: rel,
          hashes: { sha1: mod.sha1 },
          downloads: [v.files[0].url],
          fileSize: v.files[0].size
        });
        continue;
      }
    }
    overrides.push(rel);
  }

  const deps: Record<string, string> = { minecraft: instance.gameVersion };
  if (instance.loader.kind !== 'vanilla' && instance.loader.version) {
    const key =
      instance.loader.kind === 'fabric'
        ? 'fabric-loader'
        : instance.loader.kind === 'quilt'
          ? 'quilt-loader'
          : instance.loader.kind;
    deps[key] = instance.loader.version;
  }

  zip.addFile(
    'modrinth.index.json',
    Buffer.from(
      JSON.stringify(
        {
          formatVersion: 1,
          game: 'minecraft',
          versionId: '1.0.0',
          name: instance.name,
          summary: `Экспорт из Ploxel`,
          files,
          dependencies: deps
        },
        null,
        2
      )
    )
  );
  for (const rel of overrides) {
    zip.addLocalFile(path.join(instanceDir(instanceId), rel), `overrides/${path.posix.dirname(rel)}`);
  }
  for (const dir of ['config', 'defaultconfigs']) {
    const abs = path.join(instanceDir(instanceId), dir);
    if (fs.existsSync(abs)) zip.addLocalFolder(abs, `overrides/${dir}`);
  }
  zip.writeZip(targetFile);
  return targetFile;
}
/** Загрузчик в формате манифеста CurseForge: «forge-47.2.0», «fabric-0.16.9». */
function curseForgeLoaderId(instance: { loader: { kind: string; version?: string } }): string | null {
  if (instance.loader.kind === 'vanilla' || !instance.loader.version) return null;
  return `${instance.loader.kind}-${instance.loader.version}`;
}

/**
 * Экспорт сборки в формат CurseForge (zip с manifest.json) — пара к .mrpack.
 * Файлы, установленные из CurseForge, описываются ссылками (projectID/fileID);
 * остальные кладутся в overrides, чтобы архив оставался рабочим.
 */
export async function exportCurseForgeZip(instanceId: string, targetFile: string): Promise<string> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const zip = new AdmZip();
  const files: { projectID: number; fileID: number; required: boolean }[] = [];
  for (const mod of scanMods(instanceId)) {
    const rel = `${mod.kind === 'mod' ? 'mods' : mod.kind === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'}/${mod.fileName}`;
    const abs = path.join(instanceDir(instanceId), rel);
    if (!fs.existsSync(abs)) continue;
    const projectID = Number(mod.projectId);
    const fileID = Number(mod.versionId);
    if (mod.source === 'curseforge' && Number.isFinite(projectID) && Number.isFinite(fileID)) {
      files.push({ projectID, fileID, required: mod.enabled });
      continue;
    }
    zip.addLocalFile(abs, `overrides/${path.posix.dirname(rel)}`);
  }
  const loaderId = curseForgeLoaderId(instance);
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        {
          minecraft: { version: instance.gameVersion, modLoaders: loaderId ? [{ id: loaderId, primary: true }] : [] },
          manifestType: 'minecraftModpack',
          manifestVersion: 1,
          name: instance.name,
          version: '1.0.0',
          author: 'Ploxel',
          files,
          overrides: 'overrides'
        },
        null,
        2
      )
    )
  );
  for (const dir of ['config', 'defaultconfigs']) {
    const abs = path.join(instanceDir(instanceId), dir);
    if (fs.existsSync(abs)) zip.addLocalFolder(abs, `overrides/${dir}`);
  }
  zip.writeZip(targetFile);
  return targetFile;
}

/**
 * Сколько модов модпак просит скачать вручную с CurseForge
 * (config/missing_mods_checker.json), но их ещё нет в папке сборки.
 */
export function manualModsCount(instanceId: string): number {
  const dir = instanceDir(instanceId);
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'config', 'missing_mods_checker.json'), 'utf8')) as {
      pattern?: string;
      destination?: string;
    }[];
    if (!Array.isArray(list)) return 0;
    return list.filter((e) => e.pattern && !fs.existsSync(safeJoin(dir, `${e.destination || 'mods'}/${e.pattern}`))).length;
  } catch {
    return 0;
  }
}
