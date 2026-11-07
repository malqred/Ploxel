import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { instanceDir, p } from './paths';
import { readInstance, updateInstance } from './instances';
import { catalogVersions } from './catalog';
import { getCurseForgeFileDownloads, getCurseForgeMods } from './curseforge';
import { manualPageUrl } from './manual-downloads';
import { createTask, downloadMany, finishTask, updateTask } from './downloader';
import { loaderFromDependencies, recordCurseForgeFiles, safeJoin } from './modpack';
import { installLoader } from './loaders';
import type { CatalogVersion, Instance, LoaderKind, LoaderSpec, ManualFile } from '../../shared/types';

/**
 * Обновление модпака без переустановки. Сравниваем старую и новую версию модпака
 * (обе берутся из каталога) и меняем только то, что поменял автор:
 *  - моды и паки модпака: новые — докачиваются, изменённые — заменяются, убранные — удаляются;
 *  - настройки из модпака (overrides): обновляются, только если вы их не меняли;
 *  - свои моды, миры, скриншоты, options.txt — не трогаются.
 * Всё, что заменено или удалено, кладётся в backups/ сборки — можно вернуть руками.
 */

export interface PackFile {
  /** путь в сборке: mods/x.jar */
  path: string;
  /** ключ для сравнения версий: путь (Modrinth) или проект (CurseForge) */
  key: string;
  sha1?: string;
  url?: string;
  size?: number;
  /** CurseForge: проект и файл */
  projectId?: string;
  fileId?: string;
}

export interface PackContents {
  name: string;
  gameVersion: string;
  loader: LoaderSpec;
  files: PackFile[];
  /** файлы настроек модпака: путь → SHA-1 содержимого */
  overrides: Map<string, { sha1: string; data: () => Buffer }>;
  /** файлы, которые автор разрешил качать только с сайта */
  blocked: string[];
}

export interface PackVersionInfo {
  id: string;
  name: string;
  gameVersions: string[];
  date: string;
}

export interface ModpackUpdatePlan {
  fromVersion: string;
  toVersion: string;
  gameVersion: { from: string; to: string };
  loader: { from: string; to: string };
  added: string[];
  updated: string[];
  removed: string[];
  /** настройки модпака, которые обновятся */
  configsUpdated: number;
  /** настройки, которые вы меняли, — останутся ваши */
  configsKept: number;
  /** свои моды, которых нет в модпаке, — останутся */
  userFiles: number;
  /** файлы только с сайта CurseForge — их придётся скачать вручную */
  blocked: string[];
}

/** Файлы, которые обновление не трогает никогда: это ваше. */
const USER_OWNED = [/^saves\//, /^screenshots\//, /^options\.txt$/, /^optionsof\.txt$/, /^optionsshaders\.txt$/, /^servers\.dat$/];

const sha1 = (buf: Buffer) => crypto.createHash('sha1').update(buf).digest('hex');
function fileSha1(file: string): string | null {
  try {
    return sha1(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function packInfo(instance: Instance) {
  const src = instance.source;
  if (!src || (src.kind !== 'modrinth' && src.kind !== 'curseforge') || !src.projectId) {
    throw new Error('Эта сборка поставлена не из каталога — обновить её как модпак нельзя.');
  }
  return { source: src.kind, projectId: src.projectId, versionId: src.versionId };
}

/** Версии модпака под загрузчик сборки, новые — первыми. */
export async function modpackVersions(instanceId: string): Promise<{ current?: string; versions: PackVersionInfo[] }> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const { source, projectId, versionId } = packInfo(instance);
  const list = await catalogVersions(source, projectId);
  const loader = instance.loader.kind;
  const fit = list.filter((v) => !v.loaders.length || loader === 'vanilla' || v.loaders.includes(loader));
  // Сначала — версии под ту же игру: обновление модпака не должно молча менять версию Minecraft
  const sameGame = fit.filter((v) => v.gameVersions.includes(instance.gameVersion));
  const ordered = [...sameGame, ...fit.filter((v) => !sameGame.includes(v))];
  return {
    current: versionId,
    versions: ordered.map((v) => ({ id: v.id, name: v.versionNumber || v.name, gameVersions: v.gameVersions, date: v.datePublished }))
  };
}

async function downloadPack(source: 'modrinth' | 'curseforge', projectId: string, versionId: string): Promise<{ file: string; version: CatalogVersion }> {
  const versions = await catalogVersions(source, projectId);
  const version = versions.find((v) => v.id === versionId);
  if (!version) throw new Error(`Версия модпака ${versionId} не найдена в каталоге`);
  const f = version.files.find((x) => x.primary && /\.(mrpack|zip)$/i.test(x.fileName)) ?? version.files[0];
  if (!f) throw new Error('У этой версии модпака нет файла для скачивания');
  const dest = p('downloads', `pack-${projectId}-${version.id}-${f.fileName}`);
  if (!fs.existsSync(dest)) await downloadMany([{ url: f.url, dest, sha1: f.hashes?.sha1, size: f.size }], { onProgress: () => {} });
  return { file: dest, version };
}

async function readPack(file: string): Promise<PackContents> {
  const zip = new AdmZip(file);
  const overrides = new Map<string, { sha1: string; data: () => Buffer }>();
  const collect = (prefix: string) => {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = e.entryName.slice(prefix.length);
      if (!rel) continue;
      const data = e.getData();
      overrides.set(rel, { sha1: sha1(data), data: () => data });
    }
  };
  const index = zip.getEntry('modrinth.index.json');
  if (index) {
    const json = JSON.parse(index.getData().toString('utf8')) as {
      name: string;
      files: { path: string; hashes: { sha1?: string }; downloads: string[]; fileSize?: number; env?: { client?: string } }[];
      dependencies: Record<string, string>;
    };
    collect('overrides/');
    collect('client-overrides/');
    return {
      name: json.name,
      gameVersion: json.dependencies.minecraft,
      loader: loaderFromDependencies(json.dependencies),
      files: json.files
        .filter((f) => f.env?.client !== 'unsupported' && f.downloads[0])
        .map((f) => {
          const rel = f.path.replace(/\\/g, '/');
          // Имя файла меняется с каждой версией мода — сравниваем по проекту Modrinth из ссылки
          const project = f.downloads[0].match(/cdn\.modrinth\.com\/data\/([A-Za-z0-9]+)\//)?.[1];
          const folder = rel.split('/')[0];
          return { path: rel, key: project ? `mr:${folder}:${project}` : rel, sha1: f.hashes.sha1, url: f.downloads[0], size: f.fileSize };
        }),
      overrides,
      blocked: []
    };
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Неизвестный формат модпака');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as {
    name: string;
    minecraft: { version: string; modLoaders: { id: string; primary: boolean }[] };
    files: { projectID: number; fileID: number }[];
    overrides?: string;
  };
  collect(`${manifest.overrides || 'overrides'}/`);
  const primary = manifest.minecraft.modLoaders.find((m) => m.primary) ?? manifest.minecraft.modLoaders[0];
  let loader: LoaderSpec = { kind: 'vanilla' };
  if (primary) {
    const [name, ...rest] = primary.id.split('-');
    if (['forge', 'neoforge', 'fabric', 'quilt'].includes(name)) loader = { kind: name as LoaderKind, version: rest.join('-') };
  }
  const info = await getCurseForgeFileDownloads(manifest.files.map((f) => f.fileID));
  // Шейдеры и ресурспаки лежат в своих папках — как при установке модпака
  const types = new Map(
    (await getCurseForgeMods([...new Set(manifest.files.map((f) => String(f.projectID)))]).catch(() => [])).map((p) => [p.id, p.projectType])
  );
  const folder = (projectId: string) => (types.get(projectId) === 'shader' ? 'shaderpacks' : types.get(projectId) === 'resourcepack' ? 'resourcepacks' : 'mods');
  const files: PackFile[] = [];
  const blocked: string[] = [];
  for (const f of manifest.files) {
    const i = info[f.fileID];
    if (!i) continue;
    const entry = { path: `${folder(String(f.projectID))}/${i.fileName}`, key: `cf:${f.projectID}`, sha1: i.sha1, size: i.size, projectId: String(f.projectID), fileId: String(f.fileID) };
    if (!i.downloadUrl) blocked.push(i.fileName);
    files.push({ ...entry, url: i.downloadUrl ?? undefined });
  }
  return { name: manifest.name, gameVersion: manifest.minecraft.version, loader, files, overrides, blocked };
}

interface Diff {
  add: PackFile[];
  replace: { from: PackFile; to: PackFile }[];
  remove: PackFile[];
  overridesWrite: string[];
  overridesKept: string[];
  overridesRemove: string[];
}

export function diffPacks(dir: string, oldPack: PackContents, newPack: PackContents): Diff {
  const oldBy = new Map(oldPack.files.map((f) => [f.key, f]));
  const newBy = new Map(newPack.files.map((f) => [f.key, f]));
  const d: Diff = { add: [], replace: [], remove: [], overridesWrite: [], overridesKept: [], overridesRemove: [] };
  for (const [key, nf] of newBy) {
    const of = oldBy.get(key);
    if (!of) d.add.push(nf);
    else if ((of.fileId ?? of.sha1) !== (nf.fileId ?? nf.sha1) || of.path !== nf.path) d.replace.push({ from: of, to: nf });
  }
  for (const [key, of] of oldBy) if (!newBy.has(key)) d.remove.push(of);

  const owned = (rel: string) => USER_OWNED.some((r) => r.test(rel));
  for (const [rel, nv] of newPack.overrides) {
    const local = path.join(dir, rel);
    const ov = oldPack.overrides.get(rel);
    if (!fs.existsSync(local)) {
      // Пользователь удалил файл модпака сам? Если он был в старой версии — уважаем это
      if (!ov || owned(rel)) d.overridesWrite.push(rel);
      continue;
    }
    if (owned(rel)) continue;
    const localSha = fileSha1(local);
    if (localSha === nv.sha1) continue;
    // Файл не меняли после установки — обновляем; меняли — оставляем ваш
    if (ov && localSha === ov.sha1) d.overridesWrite.push(rel);
    else d.overridesKept.push(rel);
  }
  for (const [rel, ov] of oldPack.overrides) {
    if (newPack.overrides.has(rel) || owned(rel)) continue;
    const local = path.join(dir, rel);
    if (fs.existsSync(local) && fileSha1(local) === ov.sha1) d.overridesRemove.push(rel);
  }
  return d;
}

const nice = (f: PackFile) => path.basename(f.path).replace(/\.(jar|zip)$/i, '');

/** Что изменится при обновлении (ничего не меняет). */
export async function planModpackUpdate(instanceId: string, toVersionId: string): Promise<ModpackUpdatePlan> {
  const { plan } = await prepare(instanceId, toVersionId);
  return plan;
}

async function prepare(instanceId: string, toVersionId: string) {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const { source, projectId, versionId } = packInfo(instance);
  if (!versionId) throw new Error('Неизвестно, какая версия модпака стоит сейчас — переустановите модпак из каталога.');
  if (versionId === toVersionId) throw new Error('Эта версия модпака уже стоит');
  const [oldPack, newPack] = await Promise.all([
    downloadPack(source, projectId, versionId).then((x) => readPack(x.file)),
    downloadPack(source, projectId, toVersionId).then(async (x) => ({ pack: await readPack(x.file), version: x.version }))
  ]);
  const fromName = (await catalogVersions(source, projectId).catch(() => [])).find((v) => v.id === versionId);
  const dir = instanceDir(instanceId);
  const diff = diffPacks(dir, oldPack, newPack.pack);
  const packPaths = new Set([...oldPack.files.map((f) => f.path), ...oldPack.overrides.keys()]);
  let userFiles = 0;
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks']) {
    try {
      for (const name of fs.readdirSync(path.join(dir, sub))) {
        if (name.startsWith('.')) continue;
        if (!packPaths.has(`${sub}/${name.replace(/\.disabled$/, '')}`)) userFiles++;
      }
    } catch {
      /* папки нет */
    }
  }
  const plan: ModpackUpdatePlan = {
    fromVersion: fromName?.versionNumber || fromName?.name || versionId,
    toVersion: newPack.version.versionNumber || newPack.version.name,
    gameVersion: { from: instance.gameVersion, to: newPack.pack.gameVersion },
    loader: { from: `${instance.loader.kind} ${instance.loader.version ?? ''}`.trim(), to: `${newPack.pack.loader.kind} ${newPack.pack.loader.version ?? ''}`.trim() },
    added: diff.add.map(nice),
    updated: diff.replace.map((r) => nice(r.to)),
    removed: diff.remove.map(nice),
    configsUpdated: diff.overridesWrite.length,
    configsKept: diff.overridesKept.length,
    userFiles,
    blocked: newPack.pack.blocked
  };
  return { instance, source, projectId, oldPack, newPack: newPack.pack, diff, plan };
}

/** Обновить модпак до выбранной версии — фоновой задачей в «Загрузках». */
export async function applyModpackUpdate(instanceId: string, toVersionId: string): Promise<{ plan: ModpackUpdatePlan; manual: ManualFile[] }> {
  const name = readInstance(instanceId)?.name ?? 'модпак';
  const taskId = createTask(`Обновление «${name}»`, 'Сравнение версий');
  updateTask(taskId, { status: 'running', total: 100, done: 2 });
  try {
    const { instance, source, projectId, newPack, diff, plan } = await prepare(instanceId, toVersionId);
    const dir = instanceDir(instanceId);
    const backup = path.join(dir, 'backups', `modpack-${new Date().toISOString().replace(/[:.]/g, '-')}`);

    // Убираем старые файлы в бэкап (выключенный мод остаётся выключенным)
    const disabledKeys = new Set<string>();
    const stash = async (rel: string) => {
      for (const variant of [rel, `${rel}.disabled`]) {
        const from = safeJoin(dir, variant);
        if (!fs.existsSync(from)) continue;
        if (variant.endsWith('.disabled')) disabledKeys.add(rel);
        const to = path.join(backup, variant);
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.rename(from, to).catch(async () => {
          await fsp.copyFile(from, to);
          await fsp.rm(from, { force: true });
        });
      }
    };

    // Сначала качаем новое — если сеть отвалится, сборка останется как была
    const fresh = [...diff.add, ...diff.replace.map((r) => r.to)].filter((f) => f.url);
    const staging = path.join(dir, '.ploxel-update');
    await fsp.rm(staging, { recursive: true, force: true });
    updateTask(taskId, { detail: `Загрузка файлов: 0 из ${fresh.length}`, done: 10 });
    await downloadMany(
      fresh.map((f) => ({ url: f.url!, dest: safeJoin(staging, f.path), sha1: f.sha1, size: f.size })),
      {
        concurrency: 5,
        onProgress: (d, t) => updateTask(taskId, { detail: `Загрузка файлов: ${d} из ${t}`, done: 10 + Math.round((d / Math.max(1, t)) * 70) })
      }
    );

    updateTask(taskId, { detail: 'Замена файлов', done: 82 });
    const replacedFrom = new Map(diff.replace.map((r) => [r.to.path, r.from.path]));
    for (const r of diff.replace) await stash(r.from.path);
    for (const f of diff.remove) await stash(f.path);
    for (const f of fresh) {
      const src = safeJoin(staging, f.path);
      const wasDisabled = disabledKeys.has(replacedFrom.get(f.path) ?? f.path);
      const dest = safeJoin(dir, wasDisabled ? `${f.path}.disabled` : f.path);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(src, dest);
    }
    await fsp.rm(staging, { recursive: true, force: true });

    updateTask(taskId, { detail: 'Настройки модпака', done: 90 });
    for (const rel of diff.overridesWrite) {
      const target = safeJoin(dir, rel);
      if (fs.existsSync(target)) await stash(rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, newPack.overrides.get(rel)!.data());
    }
    for (const rel of diff.overridesRemove) await stash(rel);

    // CurseForge: откуда новые моды — чтобы работали «Обновить» и «Что нового»
    if (source === 'curseforge') {
      await recordCurseForgeFiles(
        instanceId,
        fresh.filter((f) => f.projectId).map((f) => ({
          fileName: path.basename(f.path),
          projectId: f.projectId!,
          fileId: f.fileId!,
          sha1: f.sha1,
          enabled: true,
          kind: (f.path.startsWith('shaderpacks/') ? 'shader' : f.path.startsWith('resourcepacks/') ? 'resourcepack' : 'mod') as 'mod' | 'shader' | 'resourcepack'
        }))
      ).catch(() => undefined);
    }

    // Новая версия игры или загрузчика — как в модпаке
    const loaderChanged = newPack.loader.kind !== instance.loader.kind || newPack.loader.version !== instance.loader.version;
    await updateInstance(instanceId, {
      gameVersion: newPack.gameVersion,
      loader: newPack.loader,
      source: { kind: source, projectId, versionId: toVersionId }
    });
    if (loaderChanged && newPack.loader.kind !== 'vanilla' && newPack.loader.version) {
      updateTask(taskId, { detail: 'Установка загрузчика', done: 95 });
      // Не удалось сейчас — поставится при запуске
      await installLoader(newPack.gameVersion, newPack.loader.kind, newPack.loader.version).catch(() => undefined);
    }
    // Закрытые автором файлы — в окно «Скачайте с сайта»: лаунчер подхватит их из «Загрузок»
    const closed = [...diff.add, ...diff.replace.map((r) => r.to)].filter((x) => !x.url && x.projectId && x.fileId);
    const projects = closed.length ? await getCurseForgeMods([...new Set(closed.map((x) => x.projectId!))]).catch(() => []) : [];
    const manual: ManualFile[] = closed.flatMap((x) => {
      const pr = projects.find((q) => q.id === x.projectId);
      if (!pr?.url) return [];
      return [{ instanceId, kind: 'mod' as const, title: pr.title, pageUrl: manualPageUrl(pr.url, x.fileId!), fileName: path.basename(x.path), size: x.size ?? 0, sha1: x.sha1 }];
    });
    finishTask(taskId);
    return { plan, manual };
  } catch (e) {
    finishTask(taskId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
