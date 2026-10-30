import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { instanceDir } from './paths';
import { readInstance, readMods, writeMods } from './instances';
import { downloadFile, sha1File } from './downloader';
import { catalogProject, catalogVersions } from './catalog';
import { readJarMetadata } from '../core/jar-meta';
import { findTwin } from '../core/project-match';
import type { CatalogVersion, Instance, InstalledMod } from '../../shared/types';

const DIR_BY_KIND: Record<InstalledMod['kind'], string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  modpack: 'mods'
};

export function contentDir(instanceId: string, kind: InstalledMod['kind']): string {
  return path.join(instanceDir(instanceId), DIR_BY_KIND[kind]);
}

/** Считывает метаданные и сверяет их с реальными файлами в папке. */
export function scanMods(instanceId: string): InstalledMod[] {
  const stored = readMods(instanceId);
  const known = new Map(stored.map((m) => [m.fileName, m]));
  const result: InstalledMod[] = [];
  const kinds: InstalledMod['kind'][] = ['mod', 'resourcepack', 'shader'];

  for (const kind of kinds) {
    const dir = contentDir(instanceId, kind);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jar') || f.endsWith('.zip') || f.endsWith('.disabled'));
    for (const file of files) {
      if (file.startsWith('.ploxel')) continue;
      const base = file.replace(/\.disabled$/, '');
      const existing = known.get(base) ?? [...known.values()].find((m) => m.fileName.replace(/\.disabled$/, '') === base);
      if (existing) {
        existing.enabled = !file.endsWith('.disabled');
        result.push(existing);
      } else {
        const meta = kind === 'mod' ? localJarMeta(path.join(dir, file)) : null;
        result.push({
          // id из имени файла: иначе при каждом сканировании он новый, и
          // включить/удалить файл, которого нет в mods.json, было нельзя
          id: localId(kind, base),
          instanceId,
          fileName: base,
          name: meta?.name || base.replace(/\.(jar|zip)$/, ''),
          version: meta?.version || '—',
          kind,
          source: 'local',
          enabled: !file.endsWith('.disabled'),
          installedAt: fileTime(path.join(dir, file))
        });
      }
    }
  }
  return result;
}

function localId(kind: InstalledMod['kind'], fileName: string): string {
  return `local-${kind}-${crypto.createHash('sha1').update(fileName).digest('hex').slice(0, 16)}`;
}

function fileTime(file: string): string {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** Название и версия из fabric.mod.json/mods.toml; кеш по размеру и дате файла. */
const jarMetaCache = new Map<string, { key: string; name?: string; version?: string }>();
function localJarMeta(file: string): { name?: string; version?: string } | null {
  try {
    const st = fs.statSync(file);
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = jarMetaCache.get(file);
    if (hit?.key === key) return hit;
    const meta = readJarMetadata(file);
    const version = meta.version && !meta.version.includes('${') ? meta.version : undefined;
    const entry = { key, name: meta.name, version };
    jarMetaCache.set(file, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function persistMods(instanceId: string, mods: InstalledMod[]) {
  await writeMods(instanceId, mods);
}

export async function setModEnabled(instanceId: string, modId: string, enabled: boolean): Promise<void> {
  const mods = scanMods(instanceId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) throw new Error('Мод не найден');
  const dir = contentDir(instanceId, mod.kind);
  const active = path.join(dir, mod.fileName);
  const disabled = `${active}.disabled`;
  if (enabled && fs.existsSync(disabled)) await fsp.rename(disabled, active);
  if (!enabled && fs.existsSync(active)) await fsp.rename(active, disabled);
  mod.enabled = enabled;
  await persistMods(instanceId, mods.filter((m) => m.id !== modId).concat(mod));
}

export async function removeMod(instanceId: string, modId: string): Promise<void> {
  const mods = scanMods(instanceId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) return;
  const dir = contentDir(instanceId, mod.kind);
  for (const name of [mod.fileName, `${mod.fileName}.disabled`]) {
    await fsp.rm(path.join(dir, name), { force: true });
  }
  await persistMods(instanceId, mods.filter((m) => m.id !== modId));
}

export interface InstallResult {
  installed: InstalledMod;
  dependencies: string[];
  skipped: string[];
}

export async function installProject(
  instance: Instance,
  source: 'modrinth' | 'curseforge',
  projectId: string,
  kind: InstalledMod['kind'],
  opts: { versionId?: string; projectName?: string; projectIcon?: string; withDependencies?: boolean } = {}
): Promise<InstallResult> {
  if (kind === 'mod' && instance.loader.kind === 'vanilla') {
    throw new Error('В ванильной сборке моды не работают. Создайте сборку с Fabric, Forge, NeoForge или Quilt.');
  }
  const loader = kind === 'mod' ? instance.loader.kind : undefined;
  const versions = await catalogVersions(source, projectId, instance.gameVersion, loader);
  if (!versions.length) {
    throw new Error(`Нет версии, совместимой с ${loader ? `${instance.gameVersion} · ${loader}` : instance.gameVersion}`);
  }
  const version = opts.versionId ? versions.find((v) => v.id === opts.versionId) : versions[0];
  if (!version) throw new Error('Выбранная версия файла не найдена');

  // Без названия в карточке был бы номер проекта («238222») — берём его из каталога
  const info = opts.projectName ? null : await catalogProject(source, projectId).catch(() => null);
  const installed = await installVersionFile(instance, source, projectId, kind, version, {
    name: opts.projectName ?? info?.title ?? projectId,
    icon: opts.projectIcon ?? info?.iconUrl
  });

  const dependencies: string[] = [];
  const skipped: string[] = [];
  if (opts.withDependencies !== false) {
    const mods = scanMods(instance.id);
    for (const dep of version.dependencies.filter((d) => d.required)) {
      if (mods.some((m) => m.projectId === dep.projectId)) {
        skipped.push(dep.projectId);
        continue;
      }
      try {
        const depVersions = await catalogVersions(source, dep.projectId, instance.gameVersion, loader);
        const pick = dep.versionId ? depVersions.find((v) => v.id === dep.versionId) ?? depVersions[0] : depVersions[0];
        if (!pick) {
          skipped.push(dep.projectId);
          continue;
        }
        const info = await catalogProject(source, dep.projectId).catch(() => null);
        // Та же библиотека уже стоит из другого каталога — второй файл был бы дубликатом
        if (info && findTwin({ title: info.title, slug: info.slug, id: dep.projectId, source }, mods)) {
          skipped.push(dep.projectId);
          continue;
        }
        await installVersionFile(instance, source, dep.projectId, kind, pick, { name: info?.title ?? dep.projectId, icon: info?.iconUrl });
        dependencies.push(dep.projectId);
      } catch {
        skipped.push(dep.projectId);
      }
    }
  }
  return { installed, dependencies, skipped };
}

async function installVersionFile(
  instance: Instance,
  source: 'modrinth' | 'curseforge',
  projectId: string,
  kind: InstalledMod['kind'],
  version: CatalogVersion,
  meta: { name: string; icon?: string }
): Promise<InstalledMod> {
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error('Автор запретил скачивание этого файла через сторонние лаунчеры. Скачайте его на странице проекта и добавьте в сборку кнопкой «Добавить файлы».');

  const dir = contentDir(instance.id, kind);
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, file.fileName);
  const tmp = `${target}.download`;

  await downloadFile({ url: file.url, dest: tmp, sha1: file.hashes?.sha1, size: file.size });
  const sha1 = file.hashes?.sha1 ?? (await sha1File(tmp));
  await fsp.rm(target, { force: true });
  await fsp.rename(tmp, target);

  const mods = scanMods(instance.id);
  const existing = mods.find((m) => m.projectId === projectId && m.kind === kind);
  // Другая версия того же проекта: старый файл убираем, иначе в папке
  // окажутся две копии мода и игра упадёт
  if (existing && existing.fileName !== file.fileName) {
    for (const name of [existing.fileName, `${existing.fileName}.disabled`]) {
      await fsp.rm(path.join(dir, name), { force: true });
    }
  }
  if (existing && !existing.enabled) {
    await fsp.rename(target, `${target}.disabled`);
  }
  const record: InstalledMod = existing ?? {
    id: crypto.randomUUID(),
    instanceId: instance.id,
    fileName: file.fileName,
    name: meta.name,
    version: version.versionNumber,
    kind,
    source,
    enabled: true,
    installedAt: new Date().toISOString()
  };
  record.fileName = file.fileName;
  record.version = version.versionNumber;
  record.versionId = version.id;
  record.sha1 = sha1;
  record.projectId = projectId;
  record.source = source;
  record.iconUrl = meta.icon ?? record.iconUrl;
  record.dependencies = version.dependencies;

  const next = mods.filter((m) => m.id !== record.id);
  next.push(record);
  await persistMods(instance.id, next);
  return record;
}

/** Загрузчики, под которые Modrinth ищет обновления для каждого вида контента. */
function updateLoaders(instance: Instance, kind: InstalledMod['kind']): string[] | undefined {
  if (kind === 'mod') return instance.loader.kind === 'vanilla' ? undefined : [instance.loader.kind];
  if (kind === 'resourcepack') return ['minecraft'];
  if (kind === 'shader') return ['iris', 'optifine', 'canvas', 'vanilla'];
  return undefined;
}

/** Проверка обновлений: Modrinth — батчем по хэшам, CurseForge — по последнему файлу. */
export async function checkUpdates(instanceId: string): Promise<{ modId: string; latest: CatalogVersion }[]> {
  const instance = readInstance(instanceId);
  if (!instance) return [];
  const mods = scanMods(instanceId);
  const result: { modId: string; latest: CatalogVersion }[] = [];

  const { checkModrinthUpdates } = await import('./modrinth');
  for (const kind of ['mod', 'resourcepack', 'shader'] as const) {
    const group = mods.filter((m) => m.kind === kind && m.source === 'modrinth' && m.sha1);
    if (!group.length) continue;
    const map = await checkModrinthUpdates(
      group.map((m) => m.sha1!),
      { gameVersions: [instance.gameVersion], loaders: updateLoaders(instance, kind) }
    );
    for (const m of group) {
      const latest = map[m.sha1!];
      if (latest && latest.id !== m.versionId && latest.files.every((f) => f.hashes?.sha1 !== m.sha1)) {
        result.push({ modId: m.id, latest });
      }
    }
  }

  // CurseForge не умеет проверять пачкой — запросы по модам идут параллельно (по 6), а не по очереди
  const cfMods = mods.filter((x) => x.source === 'curseforge' && x.projectId);
  const { catalogVersions: cv } = await import('./catalog');
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, cfMods.length) }, async () => {
      while (next < cfMods.length) {
        const m = cfMods[next++];
        try {
          const list = await cv('curseforge', m.projectId!, instance.gameVersion, m.kind === 'mod' ? instance.loader.kind : undefined);
          const latest = list[0];
          if (latest && latest.id !== m.versionId) result.push({ modId: m.id, latest });
        } catch {
          /* без ключа или сеть недоступна — пропускаем */
        }
      }
    })
  );
  return result;
}

/**
 * Обновление с бэкапом старого файла (возможен откат). Бэкап кладётся в
 * backups/mods/<дата>/, путь к нему и прежняя версия запоминаются в записи.
 */
export async function updateMod(instanceId: string, modId: string, latest?: CatalogVersion): Promise<void> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const mods = scanMods(instanceId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod?.projectId || mod.source === 'local') throw new Error('Нет данных об источнике мода');
  const versions = latest
    ? [latest]
    : await catalogVersions(mod.source, mod.projectId, instance.gameVersion, mod.kind === 'mod' ? instance.loader.kind : undefined);
  const target = versions[0];
  if (!target) throw new Error('Обновлений не найдено');

  const dir = contentDir(instanceId, mod.kind);
  const day = new Date().toISOString().slice(0, 10);
  const backupRel = path.join('backups', 'mods', day, mod.fileName);
  const current = [mod.fileName, `${mod.fileName}.disabled`].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  if (current) {
    await fsp.mkdir(path.join(instanceDir(instanceId), 'backups', 'mods', day), { recursive: true });
    await fsp.copyFile(current, path.join(instanceDir(instanceId), backupRel));
  }
  const previous = { file: backupRel, version: mod.version, versionId: mod.versionId, sha1: mod.sha1 };
  await installVersionFile(instance, mod.source, mod.projectId, mod.kind, target, {
    name: mod.name,
    icon: mod.iconUrl
  });
  if (!current) return;
  const after = scanMods(instanceId);
  const updated = after.find((m) => m.projectId === mod.projectId && m.kind === mod.kind);
  if (updated) {
    updated.previousVersionFile = previous.file;
    updated.previousVersion = previous.version;
    updated.previousVersionId = previous.versionId;
    updated.previousSha1 = previous.sha1;
    await persistMods(instanceId, after);
  }
}

/** Откат мода на предыдущую версию из бэкапа. */
export async function rollbackMod(instanceId: string, modId: string): Promise<void> {
  const mods = scanMods(instanceId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod?.previousVersionFile) throw new Error('Предыдущей версии нет — откат невозможен');
  // Старый формат хранил только папку бэкапа — тогда имя берём из записи
  let backupFile = path.join(instanceDir(instanceId), mod.previousVersionFile);
  if (fs.existsSync(backupFile) && fs.statSync(backupFile).isDirectory()) backupFile = path.join(backupFile, mod.fileName);
  if (!fs.existsSync(backupFile)) throw new Error('Файл бэкапа не найден (возможно, папка backups очищена)');

  const dir = contentDir(instanceId, mod.kind);
  for (const name of [mod.fileName, `${mod.fileName}.disabled`]) {
    await fsp.rm(path.join(dir, name), { force: true });
  }
  const restoredName = path.basename(backupFile);
  await fsp.copyFile(backupFile, path.join(dir, mod.enabled ? restoredName : `${restoredName}.disabled`));
  mod.fileName = restoredName;
  mod.version = mod.previousVersion ?? '—';
  mod.versionId = mod.previousVersionId;
  mod.sha1 = mod.previousSha1;
  mod.previousVersionFile = undefined;
  mod.previousVersion = undefined;
  mod.previousVersionId = undefined;
  mod.previousSha1 = undefined;
  await persistMods(instanceId, mods);
}

/**
 * То, что не нашлось на Modrinth, ищем в CurseForge по отпечатку файла
 * (если задан ключ CurseForge). Записи меняются на месте.
 */
async function identifyOnCurseForge(instanceId: string, rest: InstalledMod[]): Promise<number> {
  const { isCurseForgeAvailable, identifyCurseForgeFiles } = await import('./curseforge');
  if (!rest.length || !isCurseForgeAvailable()) return 0;
  const { curseforgeFingerprint } = await import('../core/murmur2');
  for (const m of rest) {
    if (m.fingerprint !== undefined) continue;
    const dir = contentDir(instanceId, m.kind);
    const file = [m.fileName, `${m.fileName}.disabled`].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
    if (file) m.fingerprint = curseforgeFingerprint(await fsp.readFile(file));
  }
  let found: Awaited<ReturnType<typeof identifyCurseForgeFiles>>;
  try {
    found = await identifyCurseForgeFiles(rest.filter((m) => m.fingerprint !== undefined).map((m) => m.fingerprint!));
  } catch {
    return 0;
  }
  let count = 0;
  for (const m of rest) {
    const hit = m.fingerprint !== undefined ? found[m.fingerprint] : undefined;
    if (!hit) continue;
    m.source = 'curseforge';
    m.projectId = hit.projectId;
    m.versionId = hit.versionId;
    m.version = hit.versionNumber;
    m.name = hit.title;
    m.iconUrl = hit.iconUrl ?? m.iconUrl;
    m.dependencies = hit.dependencies;
    count++;
  }
  return count;
}

/**
 * Распознаёт локальные файлы (добавленные вручную или импортированные): сначала
 * Modrinth по SHA1, затем CurseForge по отпечатку. Проставляет проект, версию,
 * название и иконку.
 * Возвращает число распознанных.
 */
const IDENTIFY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function identifyLocalMods(instanceId: string): Promise<number> {
  const mods = scanMods(instanceId);
  // Файлы, которые уже искали недавно и не нашли, не ищем снова при каждом открытии сборки:
  // это перечитывание сотен мегабайт и запросы к двум каталогам
  const recently = (m: InstalledMod) => !!m.identifiedAt && Date.now() - Date.parse(m.identifiedAt) < IDENTIFY_RETRY_MS;
  const local = mods.filter((m) => m.source === 'local' && !recently(m));
  if (!local.length) return 0;
  for (const m of local) {
    if (m.sha1) continue;
    const dir = contentDir(instanceId, m.kind);
    const file = [m.fileName, `${m.fileName}.disabled`].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
    if (file) m.sha1 = await sha1File(file);
  }
  const { identifyModrinthFiles } = await import('./modrinth');
  const found = await identifyModrinthFiles(local.filter((m) => m.sha1).map((m) => m.sha1!)).catch(() => ({}) as Record<string, never>);
  let count = 0;
  for (const m of local) {
    const hit = m.sha1 ? found[m.sha1] : undefined;
    if (!hit) continue;
    m.source = 'modrinth';
    m.projectId = hit.projectId;
    m.versionId = hit.versionId;
    m.version = hit.versionNumber;
    m.name = hit.title;
    m.iconUrl = hit.iconUrl ?? m.iconUrl;
    m.dependencies = hit.dependencies;
    count++;
  }
  count += await identifyOnCurseForge(instanceId, local.filter((m) => m.source === 'local'));
  const now = new Date().toISOString();
  for (const m of local) if (m.source === 'local') m.identifiedAt = now;
  // Сохраняем и нераспознанные: у них появится постоянная запись с sha1
  await persistMods(instanceId, mods);
  return count;
}

const EXT_BY_KIND: Record<InstalledMod['kind'], string[]> = {
  mod: ['.jar'],
  resourcepack: ['.zip'],
  shader: ['.zip'],
  modpack: ['.jar']
};

/** Копирует выбранные файлы в папку сборки. Оригиналы не трогаются. */
export async function addLocalFiles(instanceId: string, kind: InstalledMod['kind'], files: string[]): Promise<number> {
  const dir = contentDir(instanceId, kind);
  await fsp.mkdir(dir, { recursive: true });
  let added = 0;
  for (const file of files) {
    if (!EXT_BY_KIND[kind].includes(path.extname(file).toLowerCase())) continue;
    await fsp.copyFile(file, path.join(dir, path.basename(file)));
    added++;
  }
  return added;
}

/** Поиск дубликатов в сборке (помощник при сборке). */
export function findDuplicates(mods: InstalledMod[]): InstalledMod[][] {
  const groups = new Map<string, InstalledMod[]>();
  for (const m of mods) {
    const key = (m.projectId ?? m.name).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
export interface TransferResult {
  /** 'copied' — перенесён тот же файл, 'catalog' — поставлена версия под другую сборку */
  mode: 'copied' | 'catalog';
  name: string;
  dependencies: number;
}

/**
 * Перенос мода, ресурспака или шейдера в другую сборку. Если сборки
 * различаются версией игры или загрузчиком и проект известен каталогу,
 * в новую сборку ставится подходящая версия (с зависимостями), иначе
 * копируется сам файл. keepCopy = false — из исходной сборки он убирается.
 */
export async function transferMod(
  fromId: string,
  modId: string,
  toId: string,
  opts: { keepCopy?: boolean } = {}
): Promise<TransferResult> {
  if (fromId === toId) throw new Error('Выберите другую сборку');
  const from = readInstance(fromId);
  const to = readInstance(toId);
  if (!from || !to) throw new Error('Сборка не найдена');
  const mod = scanMods(fromId).find((m) => m.id === modId);
  if (!mod) throw new Error('Файл не найден в сборке');
  if (mod.kind === 'mod' && to.loader.kind === 'vanilla') {
    throw new Error('В сборке без загрузчика моды не работают. Выберите сборку с Fabric, Forge, NeoForge или Quilt.');
  }
  const targetMods = scanMods(toId);
  if (
    targetMods.some(
      (m) => m.kind === mod.kind && ((mod.projectId && m.projectId === mod.projectId) || m.fileName === mod.fileName)
    )
  ) {
    throw new Error(`«${mod.name}» уже есть в сборке «${to.name}»`);
  }

  const sameGame =
    from.gameVersion === to.gameVersion && (mod.kind !== 'mod' || from.loader.kind === to.loader.kind);
  let result: TransferResult;
  if (!sameGame && mod.projectId && mod.source !== 'local') {
    const res = await installProject(to, mod.source, mod.projectId, mod.kind, {
      projectName: mod.name,
      projectIcon: mod.iconUrl
    });
    if (!mod.enabled) await setModEnabled(toId, res.installed.id, false);
    result = { mode: 'catalog', name: mod.name, dependencies: res.dependencies.length };
  } else {
    const srcDir = contentDir(fromId, mod.kind);
    const dstDir = contentDir(toId, mod.kind);
    await fsp.mkdir(dstDir, { recursive: true });
    const srcName = fs.existsSync(path.join(srcDir, mod.fileName)) ? mod.fileName : `${mod.fileName}.disabled`;
    if (!fs.existsSync(path.join(srcDir, srcName))) throw new Error('Файл не найден на диске');
    await fsp.copyFile(path.join(srcDir, srcName), path.join(dstDir, srcName));
    if (mod.source !== 'local') {
      const record: InstalledMod = {
        ...mod,
        id: crypto.randomUUID(),
        instanceId: toId,
        installedAt: new Date().toISOString(),
        previousVersionFile: undefined,
        previousVersion: undefined,
        previousVersionId: undefined,
        previousSha1: undefined
      };
      await persistMods(toId, [...readMods(toId).filter((m) => m.fileName !== mod.fileName), record]);
    }
    result = { mode: 'copied', name: mod.name, dependencies: 0 };
  }
  if (!opts.keepCopy) await removeMod(fromId, modId);
  return result;
}
