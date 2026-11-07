import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { instanceDir } from './paths';
import { createInstance, deleteInstance, readInstance, updateInstance } from './instances';
import { importWorld } from './worlds';
import { downloadFile } from './downloader';
import { catalogProject, catalogVersions, searchCatalog } from './catalog';
import { installProject, removeMod, scanMods } from './mods';
import { installDatapack } from './datapacks';
import { installModpackFromProject } from './modpack';
import { applyKeybindsOnCreate } from './keybinds';
import { isReleaseVersion, sortGameVersions } from '../../shared/game-versions';
import { openZipLite } from '../core/zip-lite';
import { readJarMetadata } from '../core/jar-meta';
import { readWorldMods, type WorldModList } from '../core/world-mods';
import { manualForProject, manualFromVersion } from './manual-downloads';
import type { CatalogVersion, Instance, LoaderKind, ManualFile, WorldInstallResult } from '../../shared/types';

type Source = 'modrinth' | 'curseforge';

/**
 * Мир из каталога (CurseForge, раздел «Worlds»): zip скачивается и распаковывается
 * в saves сборки тем же импортом, что и свой архив. Сначала ищется файл под версию
 * сборки; если его нет — берётся самый новый (карты обычно открываются и в новых версиях).
 *
 * Что нужно миру, лаунчер ставит сам:
 *  1. Зависимости, которые автор указал на CurseForge: моды, ресурспаки и шейдеры — в сборку,
 *     датапаки — в сам мир; модпак — новой сборкой, и мир кладётся в неё.
 *  2. Если автор ничего не указал — список модов из level.dat (Forge/NeoForge его пишут):
 *     каждый мод ищется в каталогах и проверяется по mod-id внутри jar.
 * Моды карты обычно есть под одну версию игры и один загрузчик; если выбранная сборка
 * не подходит, создаётся подходящая.
 */
export async function installWorldFromCatalog(
  instanceId: string,
  source: Source,
  projectId: string,
  opts: { versionId?: string; name?: string } = {}
): Promise<WorldInstallResult> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const version = await pickVersion(source, projectId, instance.gameVersion, opts.versionId);
  const isZip = (name: string) => name.toLowerCase().endsWith('.zip');
  const file = version.files.find((f) => f.primary && isZip(f.fileName)) ?? version.files.find((f) => isZip(f.fileName));
  if (!file) {
    throw new Error(
      version.files.length
        ? 'У этой версии мира нет zip-архива. Выберите другую версию.'
        : 'Автор запретил скачивание через сторонние лаунчеры. Скачайте архив на странице проекта и добавьте его в «Мирах» сборки кнопкой «Импорт».'
    );
  }

  const tmp = path.join(instanceDir(instance.id), `.ploxel-world-${projectId}.zip`);
  try {
    await downloadFile({ url: file.url, dest: tmp, sha1: file.hashes?.sha1, size: file.size });

    // Что нужно миру по данным каталога
    const required = version.dependencies.filter((d) => d.required);
    const deps = await Promise.all(
      required.map(async (d) => ({ dep: d, info: await catalogProject(source, d.projectId).catch(() => null) }))
    );
    const pack = deps.find((d) => d.info?.projectType === 'modpack');
    const modDeps = deps.filter((d) => (d.info?.projectType ?? 'mod') === 'mod');
    // Автор ничего не указал — смотрим, с какими модами мир сохраняли
    const fromLevel = !pack && !modDeps.length ? readModsFromZip(tmp) : null;

    let target: Instance = instance;
    let createdInstance: string | undefined;
    // Сборку только что создали под этот мир («Создать новую» на странице мира), и она
    // пустая — переделываем её, а не плодим вторую рядом
    const fresh = isFreshEmpty(instance);
    if (pack) {
      target = await installModpackFromProject(source, pack.dep.projectId, pack.dep.versionId);
      createdInstance = target.name;
    } else {
      let setup: { gameVersion: string; loader: LoaderKind } | null = null;
      if (modDeps.length) {
        setup = await chooseModSetup(source, modDeps.map((d) => d.dep.projectId), version.gameVersions, instance);
      } else if (fromLevel?.mods.length && fromLevel.loader) {
        const gameVersion =
          fromLevel.gameVersion && isReleaseVersion(fromLevel.gameVersion)
            ? fromLevel.gameVersion
            : sortGameVersions(version.gameVersions)[0] ?? instance.gameVersion;
        setup = { gameVersion, loader: fromLevel.loader };
      }
      if (setup && (setup.gameVersion !== instance.gameVersion || setup.loader !== instance.loader.kind)) {
        if (fresh) {
          target = (await updateInstance(instance.id, { gameVersion: setup.gameVersion, loader: { kind: setup.loader } })) ?? instance;
        } else {
          target = await createInstance({ name: opts.name || 'Мир', gameVersion: setup.gameVersion, loader: { kind: setup.loader } });
        }
        applyKeybindsOnCreate(target.id, target.gameVersion);
        createdInstance = target.name;
      }
    }

    const world = await importWorld(target.id, tmp, opts.name);
    const installed: string[] = pack && createdInstance ? [createdInstance] : [];
    const missing: string[] = [];
    let needsLoader = false;
    const manual: ManualFile[] = [];

    for (const { dep, info } of deps) {
      if (info?.projectType === 'modpack') continue;
      const title = info?.title ?? dep.projectId;
      const kind = info?.projectType ?? 'mod';
      try {
        if (kind === 'datapack') {
          await installDatapack(target.id, world.folder, source, dep.projectId, { name: title, iconUrl: info?.iconUrl });
        } else if (kind === 'mod' || kind === 'resourcepack' || kind === 'shader') {
          if (kind === 'mod' && target.loader.kind === 'vanilla') {
            missing.push(title);
            needsLoader = true;
            continue;
          }
          await installProject(target, source, dep.projectId, kind, { projectName: title, projectIcon: info?.iconUrl, withDependencies: true });
        } else {
          missing.push(title);
          continue;
        }
        installed.push(title);
      } catch {
        // Автор разрешил скачивание только с сайта — ждём файл в «Загрузках»
        const blocked =
          kind === 'mod' || kind === 'resourcepack' || kind === 'shader'
            ? await manualForProject(target, source, dep.projectId, kind).catch(() => null)
            : null;
        if (blocked) manual.push(blocked);
        else missing.push(title);
      }
    }

    if (fromLevel?.mods.length) {
      if (target.loader.kind === 'vanilla') {
        needsLoader = true;
        missing.push(...fromLevel.mods.map((m) => m.id));
      } else {
        for (const mod of fromLevel.mods) {
          const found = await installByModId(target, mod, source).catch(() => null);
          if (found?.installed) installed.push(found.installed);
          else if (found?.manual) manual.push(found.manual);
          else missing.push(mod.id);
        }
      }
    }
    // Мир уехал в сборку модпака — пустая заготовка под него больше не нужна
    if (pack && fresh && target.id !== instance.id) await deleteInstance(instance.id).catch(() => undefined);
    return { world, instanceId: target.id, createdInstance, installed, missing, needsLoader, manual };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Сборка создана только что (до 30 минут), в неё не играли, в ней нет модов, паков и миров. */
export function isFreshEmpty(instance: Instance): boolean {
  if (instance.lastPlayedAt) return false;
  const created = Date.parse(instance.createdAt);
  if (!Number.isFinite(created) || Date.now() - created > 30 * 60 * 1000) return false;
  const dir = instanceDir(instance.id);
  const hasEntries = (sub: string, dirsOnly = false) => {
    try {
      return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).some((e) => (dirsOnly ? e.isDirectory() : !e.name.startsWith('.')));
    } catch {
      return false;
    }
  };
  return !hasEntries('mods') && !hasEntries('resourcepacks') && !hasEntries('shaderpacks') && !hasEntries('saves', true);
}

/** Список модов из level.dat внутри архива мира (самый верхний level.dat). */
function readModsFromZip(file: string): WorldModList | null {
  try {
    const zip = openZipLite(file);
    try {
      const level = zip.entries
        .filter((e) => !e.isDirectory && (e.name === 'level.dat' || e.name.endsWith('/level.dat')))
        .sort((a, b) => a.name.length - b.name.length)[0];
      return level ? readWorldMods(zip.read(level)) : null;
    } finally {
      zip.close();
    }
  } catch {
    return null;
  }
}

/** Каталоги иногда обрывают соединение — один повтор через полторы секунды. */
async function twice<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return fn();
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Мод по его mod-id из level.dat. Каталоги не ищут по mod-id, поэтому ищем по слову
 * и проверяем кандидата по jar: mod-id внутри должен совпасть, иначе файл удаляется
 * и пробуем следующего. Если мод нашёлся, но автор запретил скачивание через лаунчеры,
 * а версия файла совпадает с записанной в мире, — возвращаем его как «скачать вручную».
 */
export async function installByModId(
  target: Instance,
  mod: { id: string; version?: string },
  preferred: Source
): Promise<{ installed?: string; manual?: ManualFile } | null> {
  const modId = mod.id;
  const id = modId.toLowerCase();
  const already = scanMods(target.id).find((m) => m.kind === 'mod' && jarIds(target, m.fileName).includes(id));
  if (already) return { installed: already.name || modId };
  const sources: Source[] = preferred === 'curseforge' ? ['curseforge', 'modrinth'] : ['modrinth', 'curseforge'];
  const key = norm(modId);
  const candidates: { source: Source; id: string; title: string; url: string; score: number }[] = [];
  let manual: ManualFile | null = null;
  for (const source of sources) {
    const res = await twice(() =>
      searchCatalog({
      source,
      projectType: 'mod',
      query: modId.replace(/_/g, ' '),
      gameVersion: target.gameVersion,
      loader: target.loader.kind,
      sort: 'relevance',
      offset: 0,
      limit: 6
      })
    ).catch(() => null);
    for (const hit of res?.hits ?? []) {
      const names = [norm(hit.slug ?? ''), norm(hit.title)];
      // Похожее название — первым: lucky → Lucky Block
      const score = names.some((n) => n === key) ? 3 : names.some((n) => n.startsWith(key) || n.includes(key)) ? 2 : 0;
      candidates.push({ source, id: hit.id, title: hit.title, url: hit.url, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates.slice(0, 4)) {
    try {
      const versions = await twice(() => catalogVersions(c.source, c.id, target.gameVersion, target.loader.kind));
      const latest = versions[0];
      if (!latest) continue;
      if (!latest.files.length) {
        // Скачать нельзя — без jar mod-id не проверить; верим только совпадению версии
        const label = `${latest.name} ${latest.versionNumber}`;
        if (!manual && (c.score === 3 || (mod.version && mod.version.length >= 3 && label.includes(mod.version)))) {
          manual = manualFromVersion(target.id, 'mod', c.title, c.url, latest);
        }
        continue;
      }
      const res = await installProject(target, c.source, c.id, 'mod', { versionId: latest.id, projectName: c.title, withDependencies: false });
      if (jarIds(target, res.installed.fileName).includes(id)) return { installed: c.title };
      await removeMod(target.id, res.installed.id);
    } catch {
      /* нет файла под версию — следующий кандидат */
    }
  }
  if (manual) return { manual };
  return null;
}

/** mod-id из jar (сам мод и то, что он «предоставляет»), в нижнем регистре. */
function jarIds(target: Instance, fileName: string): string[] {
  try {
    const meta = readJarMetadata(path.join(instanceDir(target.id), 'mods', fileName), target.loader.kind);
    return [meta.id, ...meta.provides].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  } catch {
    return [];
  }
}

const LOADER_ORDER: LoaderKind[] = ['fabric', 'neoforge', 'forge', 'quilt'];

/**
 * Версия игры и загрузчик, под которые есть ВСЕ моды мира. Сначала пробуем сборку,
 * выбранную пользователем (если мир её поддерживает), затем версии мира от новых к старым.
 * null — общей версии нет (тогда ставим в выбранную сборку, что получится).
 */
export async function chooseModSetup(
  source: Source,
  modIds: string[],
  worldVersions: string[],
  instance: Instance
): Promise<{ gameVersion: string; loader: LoaderKind } | null> {
  const listed = sortGameVersions(worldVersions);
  const candidates =
    !listed.length || listed.includes(instance.gameVersion)
      ? [instance.gameVersion, ...listed.filter((v) => v !== instance.gameVersion)]
      : listed;
  for (const gameVersion of candidates.slice(0, 4)) {
    let allowed = null as Set<string> | null;
    let ok = true;
    for (const id of modIds) {
      const versions = await catalogVersions(source, id, gameVersion).catch(() => []);
      if (!versions.length) {
        ok = false;
        break;
      }
      const loaders = new Set(versions.flatMap((v) => v.loaders));
      if (!loaders.size) continue; // загрузчик не указан — не ограничивает выбор
      allowed = allowed ? new Set([...allowed].filter((l: string) => loaders.has(l))) : loaders;
    }
    if (!ok) continue;
    const pool = allowed ?? new Set<string>(LOADER_ORDER);
    if (gameVersion === instance.gameVersion && pool.has(instance.loader.kind)) {
      return { gameVersion, loader: instance.loader.kind };
    }
    const loader = LOADER_ORDER.find((l) => pool.has(l));
    if (loader) return { gameVersion, loader };
  }
  return null;
}

async function pickVersion(source: Source, projectId: string, gameVersion: string, versionId?: string): Promise<CatalogVersion> {
  let version: CatalogVersion | undefined;
  if (versionId) {
    version = (await catalogVersions(source, projectId)).find((v) => v.id === versionId);
  } else {
    version = (await catalogVersions(source, projectId, gameVersion))[0] ?? (await catalogVersions(source, projectId))[0];
  }
  if (!version) throw new Error('У этого мира нет файлов для скачивания');
  return version;
}
