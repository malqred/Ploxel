// Менеджер зависимостей модов: план установки, атомарная установка,
// проверка сборки и помощник по автоисправлению.
//
// Сеть и загрузчики вынесены в `deps` — в тестах подставляются фейки,
// в приложении используются реальные сервисы (catalog, downloadFile).

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { instanceDir } from './paths';
import { contentDir, findDuplicates, persistMods, scanMods } from './mods';
import { checkUpdates } from './mods';
import { downloadFile, sha1File } from './downloader';
import type { DownloadItem } from './downloader';
import { catalogProject, catalogVersions, isCurseForgeAvailable } from './catalog';
import { readJarMetadata, satisfiesRange } from '../core/jar-meta';
import { getModrinthVersionsByIds } from './modrinth';
import { getCurseForgeFilesByIds } from './curseforge';
import type { JarReadResult } from '../core/jar-meta';
import type {
  BuildIssue,
  BuildIssueKind,
  CatalogProject,
  CatalogVersion,
  DependencyItem,
  DependencyPlan,
  DependencySource,
  Instance,
  InstalledMod
} from '../../shared/types';

/** Зависимости, которые можно подменить в тестах. */
export interface DependencyDeps {
  download?: (item: DownloadItem, signal?: AbortSignal) => Promise<void>;
  catalog?: (source: DependencySource, projectId: string, gameVersion?: string, loader?: string) => Promise<CatalogVersion[]>;
  project?: (source: DependencySource, projectId: string) => Promise<CatalogProject | null>;
  checkUpdates?: (instanceId: string) => Promise<{ modId: string; latest: CatalogVersion }[]>;
  isCurseForgeAvailable?: () => boolean;
  /** версии игры и загрузчики по id версий каталога (для тестов — подмена сети) */
  versionInfo?: (ids: string[]) => Promise<Record<string, { gameVersions: string[]; loaders: string[] }>>;
  /** то же для файлов CurseForge */
  cfVersionInfo?: (ids: string[]) => Promise<Record<string, { gameVersions: string[]; loaders: string[] }>>;
}

const CF_ERROR =
  'Каталог CurseForge сейчас недоступен: не задан ключ CurseForge (Настройки → Общие → Ключи API). Мод можно поискать в другом каталоге.';

// ---- кэш версий в памяти (на время сессии) ----
const versionCache = new Map<string, Promise<CatalogVersion[]>>();
const projectCache = new Map<string, Promise<CatalogProject | null>>();

/** Сбросить кэши (полезно после смены ключей/зеркал и в тестах). */
export function clearDependencyCaches(): void {
  versionCache.clear();
  projectCache.clear();
}

// ---- типы рёбер зависимостей ----
export type DepType = 'required' | 'optional' | 'incompatible' | 'embedded';
export interface DepEdge {
  projectId: string;
  versionId?: string;
  required: boolean;
  /** dependency_type Modrinth, если каталог его сохранил. */
  type?: DepType;
}

/** Нормализованный каталог хранит только `required`; тип берём, если он есть в данных. */
function edgesOf(version: CatalogVersion): DepEdge[] {
  return (version.dependencies ?? []).map((d) => {
    const raw = d as DepEdge;
    return {
      projectId: d.projectId,
      versionId: d.versionId,
      required: d.required,
      type: raw.type ?? (d.required ? 'required' : 'optional')
    };
  });
}

function cachedVersions(
  catalog: NonNullable<DependencyDeps['catalog']>,
  source: DependencySource,
  projectId: string,
  gameVersion?: string,
  loader?: string
): Promise<CatalogVersion[]> {
  const key = [source, projectId, gameVersion ?? '', loader ?? ''].join('|');
  let promise = versionCache.get(key);
  if (!promise) {
    promise = catalog(source, projectId, gameVersion, loader);
    versionCache.set(key, promise);
  }
  return promise;
}

function cachedProject(projectFn: NonNullable<DependencyDeps['project']>, source: DependencySource, projectId: string): Promise<CatalogProject | null> {
  const key = `${source}|${projectId}`;
  let promise = projectCache.get(key);
  if (!promise) {
    promise = projectFn(source, projectId).catch(() => null);
    projectCache.set(key, promise);
  }
  return promise;
}

export interface BuildPlanOptions {
  /** брать ли необязательные зависимости (по умолчанию true) */
  includeOptional?: boolean;
  /** максимальная глубина обхода (по умолчанию 6) */
  maxDepth?: number;
  /** имя корневого проекта, если уже известно (иначе запросим каталог) */
  projectName?: string;
}

/**
 * Построить план установки: транзитивно обходит зависимости выбранного
 * проекта, помечает встроённые/несовместимые/уже установленные, циклы.
 */
export async function buildPlan(
  instance: Instance,
  source: DependencySource,
  projectId: string,
  versionId?: string,
  options: BuildPlanOptions = {},
  deps: DependencyDeps = {}
): Promise<DependencyPlan> {
  const catalog = deps.catalog ?? catalogVersions;
  const projectFn = deps.project ?? catalogProject;
  const isCf = deps.isCurseForgeAvailable ?? isCurseForgeAvailable;
  if (source === 'curseforge' && !isCf()) throw new Error(CF_ERROR);
  if (instance.loader.kind === 'vanilla') {
    throw new Error('В ванильной сборке моды не работают. Создайте сборку с Fabric, Forge, NeoForge или Quilt.');
  }

  const gameVersion = instance.gameVersion;
  const loader = instance.loader.kind;
  const installed = scanMods(instance.id).filter((m) => m.kind === 'mod');
  const byProjectId = new Map(installed.filter((m) => m.projectId).map((m) => [m.projectId as string, m]));
  const bySha1 = new Map(installed.filter((m) => m.sha1).map((m) => [m.sha1 as string, m]));

  const includeOptional = options.includeOptional !== false;
  const maxDepth = options.maxDepth ?? 6;
  const items: DependencyItem[] = [];
  const byKey = new Map<string, DependencyItem>();
  const warnings: string[] = [];
  const warned = new Set<string>();
  const conflicts: DependencyPlan['conflicts'] = [];

  const addWarning = (text: string) => {
    if (warned.has(text)) return;
    warned.add(text);
    warnings.push(text);
  };

  const visit = async (
    depSource: DependencySource,
    depProjectId: string,
    versionHint: string | undefined,
    edge: DepEdge | null,
    depth: number,
    pathIds: string[]
  ): Promise<DependencyItem | null> => {
    const key = `${depSource}:${depProjectId}`;

    const existing = byKey.get(key);
    if (existing) {
      if (pathIds.includes(depProjectId)) {
        const names = [...pathIds, depProjectId].map((id) => byKey.get(`${depSource}:${id}`)?.projectName ?? id);
        addWarning(`Циклическая зависимость: ${names.join(' → ')}`);
      }
      if (edge?.required) existing.required = true;
      return existing;
    }
    if (depth > maxDepth) return null;

    const item: DependencyItem = {
      key,
      source: depSource,
      projectId: depProjectId,
      projectName: depProjectId,
      required: edge?.required ?? true,
      optional: edge?.type === 'optional',
      embedded: edge?.type === 'embedded',
      incompatible: false,
      installed: false,
      selected: false,
      depth
    };
    byKey.set(key, item);
    items.push(item);

    const project = await cachedProject(projectFn, depSource, depProjectId);
    if (project) {
      item.projectName = project.title || depProjectId;
      item.iconUrl = project.iconUrl;
    }
    if (depth === 0 && options.projectName) item.projectName = options.projectName;

    // Встроенные зависимости — отдельный файл ставить не нужно.
    if (edge?.type === 'embedded') {
      item.note = 'Встроено в файл, устанавливать отдельно не нужно';
      return item;
    }
    // Несоответствие типов — конфликт, не устанавливаем и не обходим.
    if (edge?.type === 'incompatible') {
      item.incompatible = true;
      item.note = 'Помечен как несовместимый с основным модом';
      conflicts.push({
        left: (pathIds[pathIds.length - 1] && byKey.get(`${depSource}:${pathIds[pathIds.length - 1]}`)?.projectName) ?? item.projectName,
        right: item.projectName,
        reason: 'dependency_type: incompatible'
      });
      return item;
    }

    const already = byProjectId.get(depProjectId);
    if (already) {
      item.installed = true;
      item.versionNumber = already.version;
      item.fileName = already.fileName;
      item.note = 'Уже установлен в сборке';
      return item;
    }

    const versions = await cachedVersions(catalog, depSource, depProjectId, gameVersion, loader);
    if (!versions.length) {
      item.incompatible = true;
      item.note = `Нет версии для Minecraft ${gameVersion} (${loader})`;
      addWarning(`Для «${item.projectName}» нет версии, совместимой с Minecraft ${gameVersion} и загрузчиком ${loader}`);
      return item;
    }

    let version = versionHint ? versions.find((v) => v.id === versionHint) : undefined;
    if (versionHint && !version) {
      version = versions[0];
      addWarning(`Версия «${versionHint}» мода «${item.projectName}» не подходит под ${gameVersion} — взята ${version.versionNumber}`);
    }
    if (!version) version = versions[0];
    item.versionId = version.id;
    item.versionNumber = version.versionNumber;

    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (file) {
      item.fileName = file.fileName;
      item.sizeBytes = file.size;
      if (file.hashes?.sha1 && bySha1.has(file.hashes.sha1)) {
        item.installed = true;
        item.note = 'Уже установлен (совпадает хэш файла)';
        return item;
      }
    } else {
      item.incompatible = true;
      item.note = 'Нет доступного файла для скачивания';
      addWarning(`У мода «${item.projectName}» нет доступного файла — возможно, источник запрещает сторонние загрузки`);
      return item;
    }

    item.selected = item.required;
    pathIds.push(depProjectId);
    try {
      for (const dep of edgesOf(version)) {
        if (dep.type === 'optional' && !includeOptional) continue;
        await visit(depSource, dep.projectId, dep.versionId, dep, depth + 1, pathIds);
      }
    } finally {
      pathIds.pop();
    }
    return item;
  };

  const root = await visit(source, projectId, versionId, { projectId, required: true, type: 'required' }, 0, []);
  items.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
  return { root, items, warnings, conflicts };
}

export interface InstallPlanResult {
  /** ключи пунктов, которые были установлены */
  installedKeys: string[];
  /** куда свёрнуты старые файлы, если что-то уже было заменено */
  backupDir?: string;
}

/**
 * Атомарная установка выбранного из плана:
 *  1) скачиваем ВСЕ выбранные файлы во временную папку (с проверкой хэшей);
 *  2) перемещаем в папку mods, старые файлы — в backups/mods/<timestamp>;
 *  3) при любой ошибке откатываем всё, что уже перемещено в этой операции.
 */
export async function installPlan(
  instance: Instance,
  plan: DependencyPlan,
  selectedKeys: string[],
  deps: DependencyDeps = {}
): Promise<InstallPlanResult> {
  const catalog = deps.catalog ?? catalogVersions;
  const download = deps.download ?? downloadFile;
  const isCf = deps.isCurseForgeAvailable ?? isCurseForgeAvailable;

  const selected = plan.items.filter((i) => selectedKeys.includes(i.key) && !i.installed && !i.embedded);
  for (const item of selected) {
    if (item.incompatible) {
      throw new Error(`Нельзя установить «${item.projectName}»: пункт помечен как несовместимый`);
    }
    if (item.source === 'curseforge' && !isCf()) throw new Error(CF_ERROR);
  }
  if (!selected.length) return { installedKeys: [] };
  if (instance.loader.kind === 'vanilla') {
    throw new Error('В ванильной сборке моды не работают. Создайте сборку с Fabric, Forge, NeoForge или Quilt.');
  }

  const instRoot = instanceDir(instance.id);
  const stamp = Date.now().toString(36);
  const staging = path.join(instRoot, 'backups', 'mods', `staging-${stamp}`);
  const backupDir = path.join(instRoot, 'backups', 'mods', stamp);
  const targetDir = contentDir(instance.id, 'mod');
  await fsp.mkdir(staging, { recursive: true });
  await fsp.mkdir(targetDir, { recursive: true });

  // 1) Скачиваем всё во временную папку.
  interface Staged {
    item: DependencyItem;
    version: CatalogVersion;
    fileName: string;
    sha1?: string;
    stagedPath: string;
    targetPath: string;
  }
  const staged: Staged[] = [];
  try {
    for (const item of selected) {
      const versions = await cachedVersions(catalog, item.source, item.projectId, instance.gameVersion, instance.loader.kind);
      const version = (item.versionId && versions.find((v) => v.id === item.versionId)) || versions[0];
      if (!version) throw new Error(`Нет доступной версии мода «${item.projectName}»`);
      const file = version.files.find((f) => f.primary && f.url) ?? version.files.find((f) => f.url);
      if (!file) {
        throw new Error(
          `Нет ссылки на файл мода «${item.projectName}»: CurseForge запрещает сторонние загрузки. Скачайте файл вручную на странице мода и положите его в папку mods.`
        );
      }
      const stagedPath = path.join(staging, file.fileName);
      await download({ url: file.url, dest: stagedPath, sha1: file.hashes?.sha1, size: file.size });
      staged.push({
        item,
        version,
        fileName: file.fileName,
        sha1: file.hashes?.sha1,
        stagedPath,
        targetPath: path.join(targetDir, file.fileName)
      });
    }
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw e;
  }

  // 2) Перемещаем (старые файлы — в бэкап) и 3) пишем метаданные.
  const moved: { targetPath: string; backupPath: string | null }[] = [];
  let usedBackup = false;
  try {
    for (const s of staged) {
      let backupPath: string | null = null;
      if (fs.existsSync(s.targetPath)) {
        if (!usedBackup) {
          await fsp.mkdir(backupDir, { recursive: true });
          usedBackup = true;
        }
        backupPath = path.join(backupDir, s.fileName);
        await fsp.copyFile(s.targetPath, backupPath);
        await fsp.rm(s.targetPath);
      }
      await fsp.rename(s.stagedPath, s.targetPath);
      moved.push({ targetPath: s.targetPath, backupPath });
    }

    const mods = scanMods(instance.id);
    const now = new Date().toISOString();
    let next = mods;
    for (const s of staged) {
      const sha1 = s.sha1 ?? (await sha1File(s.targetPath));
      // scanMods уже создал локальную запись для нового файла — обновляем её,
      // а не добавляем вторую.
      const existing = next.find(
        (m) =>
          m.kind === 'mod' &&
          ((m.source === s.item.source && m.projectId === s.item.projectId) || m.fileName === s.fileName)
      );
      const record: InstalledMod = existing ?? {
        id: crypto.randomUUID(),
        instanceId: instance.id,
        fileName: s.fileName,
        name: s.item.projectName,
        version: s.item.versionNumber ?? '—',
        kind: 'mod',
        source: s.item.source,
        enabled: true,
        installedAt: now
      };
      record.fileName = s.fileName;
      record.name = s.item.projectName;
      record.version = s.item.versionNumber ?? record.version;
      record.versionId = s.item.versionId;
      record.sha1 = sha1;
      record.projectId = s.item.projectId;
      record.source = s.item.source;
      record.iconUrl = s.item.iconUrl ?? record.iconUrl;
      record.enabled = true;
      record.dependencies = s.version.dependencies;
      next = existing ? next.map((m) => (m.id === record.id ? record : m)) : next.concat(record);
    }
    await persistMods(instance.id, next);
  } catch (e) {
    // Откат: восстанавливаем старые файлы, убираем то, что поставили.
    for (const m of [...moved].reverse()) {
      try {
        if (m.backupPath && fs.existsSync(m.backupPath)) await fsp.copyFile(m.backupPath, m.targetPath);
        else await fsp.rm(m.targetPath, { force: true });
      } catch {
        /* best effort — главное, чтобы сборка не осталась с чужим файлом */
      }
    }
    if (usedBackup) await fsp.rm(backupDir, { recursive: true, force: true });
    await fsp.rm(staging, { recursive: true, force: true });
    throw e;
  }

  await fsp.rm(staging, { recursive: true, force: true });
  return { installedKeys: selected.map((i) => i.key), backupDir: usedBackup ? backupDir : undefined };
}

/**
 * Проверка сборки: недостающие зависимости, устаревшие моды, конфликты,
 * дубликаты и несовместимость с версией игры/загрузчиком.
 */
export async function checkBuild(instance: Instance, deps: DependencyDeps = {}): Promise<BuildIssue[]> {
  const checkUpd = deps.checkUpdates ?? checkUpdates;
  const issues: BuildIssue[] = [];
  let seq = 0;
  const mk = (
    kind: BuildIssueKind,
    title: string,
    explanation: string,
    changes: string,
    risks: string,
    confidence: BuildIssue['confidence'],
    fixable: boolean,
    payload: Record<string, unknown>
  ): BuildIssue => ({ id: `build-${kind}-${++seq}`, kind, title, explanation, changes, risks, confidence, fixable, payload });

  const mods = scanMods(instance.id).filter((m) => m.kind === 'mod');
  const active = mods.filter((m) => m.enabled);
  const gameVersionChecked = new Set<string>();
  const projectFn = deps.project ?? catalogProject;
  const projectTitle = async (source: InstalledMod['source'], id: string): Promise<string> => {
    if (source === 'local') return id;
    try {
      return (await cachedProject(projectFn, source, id))?.title ?? id;
    } catch {
      return id;
    }
  };
  // Несовместимость с версией игры: файл может быть установлен под другую
  // версию, а в самом jar это не записано (так у Sodium). Если мод есть в
  // каталоге — предлагаем заменить его на версию для этой сборки.
  const incompatibleIssue = (m: InstalledMod, explanation: string): BuildIssue => {
    const canReplace = !!m.projectId && m.source !== 'local';
    return mk(
      'incompatible',
      `«${m.name}» не для Minecraft ${instance.gameVersion}`,
      explanation,
      canReplace
        ? `Заменить на версию мода для ${instance.gameVersion}, если она есть (старый файл уйдёт в бэкап).`
        : 'Найти версию мода для этой версии игры или выключить мод.',
      'Если подходящей версии нет, мод придётся выключить.',
      'high',
      canReplace,
      { modId: m.id, via: m.fileName, dep: 'minecraft', replace: canReplace }
    );
  };

  // Метаданные из самих файлов.
  const metaOf = new Map<string, JarReadResult>();
  for (const m of mods) {
    const file = path.join(contentDir(instance.id, m.kind), m.fileName);
    let meta: JarReadResult;
    try {
      meta = readJarMetadata(file);
    } catch {
      meta = { file, provides: [], depends: {}, breaks: {}, optional: {}, loaders: [] };
    }
    metaOf.set(m.id, meta);
  }

  const norm = (s: string) => s.toLowerCase();
  // Какие mod-id «покрыты» установленными модами (id + provides + имя как подсказка).
  const satisfied = new Set<string>();
  const idOwners = new Map<string, InstalledMod[]>();
  for (const m of active) {
    const meta = metaOf.get(m.id);
    const ids = [...(meta?.id ? [meta.id] : []), ...(meta?.provides ?? []), m.name];
    // Вложенные модули закрывают зависимости, но в конфликты не попадают
    for (const b of meta?.bundled ?? []) satisfied.add(norm(b));
    for (const id of ids) {
      const n = norm(id);
      if (!n) continue;
      satisfied.add(n);
      const owners = idOwners.get(n) ?? [];
      if (!owners.includes(m)) owners.push(m);
      idOwners.set(n, owners);
    }
  }

  // Зависимости, которые даёт сама сборка (загрузчик), а не моды.
  // В fabric.mod.json загрузчик называется fabricloader, в quilt — quilt_loader.
  const LOADER_DEP: Record<string, string[]> = {
    fabricloader: ['fabric', 'quilt'],
    fabric_loader: ['fabric', 'quilt'],
    'fabric-loader': ['fabric', 'quilt'],
    quilt_loader: ['quilt'],
    'quilt-loader': ['quilt'],
    forge: ['forge', 'neoforge'],
    fml: ['forge', 'neoforge'],
    javafml: ['forge', 'neoforge'],
    neoforge: ['forge', 'neoforge']
  };
  const loaderFamily = (l: string) => (l === 'forge' || l === 'neoforge' ? 'forge' : l);

  for (const m of active) {
    const meta = metaOf.get(m.id)!;

    // 0) Версия игры и загрузчик по самому файлу — проверяем всегда, даже
    // если мод распознан в каталоге (раньше эта проверка пропускалась).
    for (const [depId, ranges] of Object.entries(meta.depends)) {
      const key = norm(depId);
      if (key === 'minecraft') {
        // Массив диапазонов в fabric.mod.json — «любой из»: ["1.21", "1.21.1"]
        if (!ranges.some((r) => satisfiesRange(instance.gameVersion, r))) {
          gameVersionChecked.add(m.id);
          issues.push(incompatibleIssue(m, `Мод требует версию игры ${ranges.join(' или ')}, а в сборке ${instance.gameVersion}.`));
        } else {
          // Сам файл разрешает эту версию — список версий в каталоге (его
          // заполняет автор вручную) уже не перепроверяем
          gameVersionChecked.add(m.id);
        }
      } else if (LOADER_DEP[key]) {
        if (!LOADER_DEP[key].includes(instance.loader.kind)) {
          issues.push(
            mk(
              'incompatible',
              `«${m.name}» требует загрузчик ${depId}`,
              `Мод сделан для ${depId}, а сборка использует ${instance.loader.kind}.`,
              'Убрать мод или создать сборку с подходящим загрузчиком.',
              'Без нужного загрузчика мод не запустится.',
              'high',
              false,
              { modId: m.id, via: m.fileName, dep: depId }
            )
          );
        } else if (instance.loader.version && !ranges.some((r) => satisfiesRange(instance.loader.version!, r))) {
          issues.push(
            mk(
              'incompatible',
              `«${m.name}» требует более новый загрузчик`,
              `В сборке ${depId} ${instance.loader.version}, а мод требует ${ranges.join(' или ')}.`,
              'Сделать копию сборки с более новым загрузчиком или выбрать более старую версию мода.',
              'Смена загрузчика может потребовать обновить другие моды.',
              'high',
              false,
              { modId: m.id, via: m.fileName, dep: depId, ranges }
            )
          );
        }
      }
    }

    // 1) Зависимости: каталог (Modrinth/CF) — если есть, иначе jar-метаданные.
    if (m.dependencies?.length) {
      const installedProjectIds = new Set(mods.map((x) => x.projectId).filter(Boolean) as string[]);
      for (const d of m.dependencies) {
        if (!d.required || d.projectId === m.projectId || installedProjectIds.has(d.projectId)) continue;
        // Зависимость может лежать внутри самого мода (jar-in-jar) или прийти
        // с другим модом — сверяем slug и название проекта с mod-id в сборке
        let depProject: CatalogProject | null = null;
        if (m.source !== 'local') depProject = await cachedProject(projectFn, m.source, d.projectId).catch(() => null);
        if (depProject && [depProject.slug, depProject.title].some((x) => x && satisfied.has(norm(x)))) continue;
        const depName = depProject?.title ?? (await projectTitle(m.source, d.projectId));
        issues.push(
          mk(
            'missing',
            `Не установлена зависимость «${depName}»`,
            `Мод «${m.name}» требует «${depName}», но его нет в папке mods.`,
            `Установить «${depName}» из каталога ${m.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}.`,
            'Зависимости обычно совместимы; возможна подтяжка ещё одной цепочки модов.',
            'high',
            true,
            { modId: m.id, via: m.fileName, depProjectId: d.projectId, source: m.source, versionId: d.versionId }
          )
        );
      }
    } else {
      for (const [depId, ranges] of Object.entries(meta.depends)) {
        const key = norm(depId);
        if (key === 'minecraft' || LOADER_DEP[key] || key === 'java' || satisfied.has(key)) continue;
        issues.push(
          mk(
            'missing',
            `Не установлена зависимость «${depId}»`,
            `По метаданным файла «${m.name}» требуется мод «${depId}», но он не найден в сборке.`,
            `Найти и установить «${depId}» в каталоге (id из jar не всегда совпадает с id проекта).`,
            'Может потребоваться ручной подбор версии.',
            'medium',
            false,
            { modId: m.id, via: m.fileName, dep: depId, ranges }
          )
        );
      }
      // Необязательные зависимости — слабее: low-конфиденсия, не чиним автоматически.
      for (const [depId, ranges] of Object.entries(meta.optional ?? {})) {
        const key = norm(depId);
        if (key === 'java' || key === 'minecraft' || LOADER_DEP[key] || satisfied.has(key)) continue;
        issues.push(
          mk(
            'missing',
            `Не установлена необязательная зависимость «${depId}»`,
            `«${m.name}» работает и без «${depId}», но часть функций будет выключена.`,
            `При желании установить «${depId}».`,
            'Минимальная: зависимость необязательна.',
            'low',
            false,
            { modId: m.id, via: m.fileName, dep: depId, ranges, optional: true }
          )
        );
      }
    }

    // 2) Конфликты: breaks и общие provides.
    for (const [brokenId, brokenRanges] of Object.entries(meta.breaks)) {
      const n = norm(brokenId);
      // breaks почти всегда с диапазоном («iris: <1.8.0») — конфликт, только
      // если установленная версия в него попадает
      const others = (idOwners.get(n) ?? []).filter((o) => {
        if (o.id === m.id) return false;
        const otherMeta = metaOf.get(o.id);
        // Совпадение по имени — подсказка для зависимостей, не для конфликтов
        const realId = !!otherMeta?.id && (norm(otherMeta.id) === n || otherMeta.provides.some((p) => norm(p) === n));
        if (!realId) return false;
        if (!brokenRanges.length || brokenRanges.some((r) => !r.trim() || r.trim() === '*')) return true;
        const version = otherMeta?.version || o.version;
        if (!version || version.includes('${')) return false;
        return brokenRanges.some((r) => satisfiesRange(version, r));
      });
      if (others.length) {
        issues.push(
          mk(
            'conflict',
            `«${m.name}» несовместим с «${others[0].name}»`,
            `Автор «${m.name}» указал, что мод не работает с установленной версией «${others[0].name}».`,
            `Выключить «${others[0].name}» (файл останется в папке, его можно включить обратно).`,
            'Функции выключенного мода будут недоступны.',
            'high',
            true,
            { modId: m.id, otherModId: others[0].id, via: m.fileName, broken: brokenId, modIds: [m.id, others[0].id], disableId: others[0].id }
          )
        );
      }
    }

    // 3) Несовместимость загрузчика по метаданным файла.
    if (instance.loader.kind !== 'vanilla' && meta.loaders.length) {
      const ok = meta.loaders.some((l) => loaderFamily(l) === loaderFamily(instance.loader.kind));
      if (!ok) {
        issues.push(
          mk(
            'incompatible',
            `«${m.name}» сделан для другого загрузчика`,
            `Файл модифицирован под ${meta.loaders.join(' / ')}, а сборка использует ${instance.loader.kind}.`,
            'Убрать мод или создать сборку с подходящим загрузчиком.',
            'Низкая: без смены загрузчика мод не запустится.',
            'medium',
            false,
            { modId: m.id, via: m.fileName, loaders: meta.loaders, instanceLoader: instance.loader.kind }
          )
        );
      }
    }
  }

  // 4) Provides-конфликты: два мода «дают» один и тот же mod-id.
  for (const [n, owners] of idOwners) {
    const all = owners.filter((o) => (metaOf.get(o.id)?.provides ?? []).some((p) => norm(p) === n));
    // Две копии одного мода — это дубликат (свой пункт выше), а не конфликт
    const seen = new Set<string>();
    const providing = all.filter((o) => {
      const key = o.projectId ?? norm(metaOf.get(o.id)?.provides[0] ?? o.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (providing.length > 1) {
      issues.push(
        mk(
          'conflict',
          `«${providing[0].name}» и «${providing[1].name}» конфликтуют`,
          `Оба мода предоставляют mod-id «${n}» — загрузчик запустит только один.`,
          `Выключить «${providing[1].name}», оставить «${providing[0].name}».`,
          'Функции выключенного мода будут недоступны.',
          'medium',
          true,
          { provideId: n, modIds: providing.map((p) => p.id), via: [providing[0].fileName, providing[1].fileName], disableId: providing[1].id }
        )
      );
    }
  }

  // Версии игры по данным каталога — для файлов из Modrinth и CurseForge одинаково
  const isCfOn = deps.isCurseForgeAvailable ?? isCurseForgeAvailable;
  for (const source of ['modrinth', 'curseforge'] as const) {
    const fromCatalog = active.filter((m) => m.source === source && m.versionId && !gameVersionChecked.has(m.id));
    if (!fromCatalog.length || (source === 'curseforge' && !isCfOn())) continue;
    try {
      const infoFn =
        source === 'modrinth' ? (deps.versionInfo ?? getModrinthVersionsByIds) : (deps.cfVersionInfo ?? getCurseForgeFilesByIds);
      const info = await infoFn(fromCatalog.map((m) => m.versionId!));
      for (const m of fromCatalog) {
        const v = info[m.versionId!];
        if (v && v.gameVersions.length && !v.gameVersions.includes(instance.gameVersion)) {
          issues.push(
            incompatibleIssue(m, `Установленный файл сделан для Minecraft ${v.gameVersions.slice(-3).join(', ')}, а в сборке ${instance.gameVersion}.`)
          );
        }
      }
    } catch {
      /* без сети — проверим в следующий раз */
    }
  }

  return issues.concat(await collectDuplicatesAndUpdates(instance, mods, metaOf, checkUpd, mk));
}

/** Дубликаты (projectId/имя/хэш/одинаковый mod-id) и устаревшие моды. */
async function collectDuplicatesAndUpdates(
  instance: Instance,
  mods: InstalledMod[],
  metaOf: Map<string, JarReadResult>,
  checkUpd: NonNullable<DependencyDeps['checkUpdates']>,
  mk: (
    kind: BuildIssueKind,
    title: string,
    explanation: string,
    changes: string,
    risks: string,
    confidence: BuildIssue['confidence'],
    fixable: boolean,
    payload: Record<string, unknown>
  ) => BuildIssue
): Promise<BuildIssue[]> {
  const issues: BuildIssue[] = [];
  const seenDupKeys = new Set<string>();
  const pushDup = (group: InstalledMod[], reason: string, extra: Record<string, unknown> = {}) => {
    if (group.length < 2) return;
    const key = 'dup:' + group.map((g) => g.id).sort().join(',');
    if (seenDupKeys.has(key)) return;
    seenDupKeys.add(key);
    // Оставляем тот, что установлен позже или из каталога, — остальные дубликаты.
    const keep = [...group].sort((a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? ''))[0];
    issues.push(
      mk(
        'duplicate',
        `Дубликаты: ${group.map((g) => g.fileName).join(', ')}`,
        `В папке mods ${reason}: ${group.map((g) => `«${g.name}»`).join(' и ')}.`,
        `Удалить лишние файлы, оставить «${keep.fileName}».`,
        'Низкая: удаляем только точные дубликаты.',
        'high',
        true,
        { keep: keep.id, remove: group.filter((g) => g.id !== keep.id).map((g) => g.id), modIds: group.map((g) => g.id), ...extra }
      )
    );
  };

  for (const group of findDuplicates(mods)) {
    pushDup(group, 'одинаковый projectId или имя');
  }
  const byHash = new Map<string, InstalledMod[]>();
  for (const m of mods) {
    if (!m.sha1) continue;
    byHash.set(m.sha1, [...(byHash.get(m.sha1) ?? []), m]);
  }
  for (const [hash, group] of byHash) {
    pushDup(group, 'одинаковый хэш файла', { byHash: true, sha1: hash });
  }
  const byModId = new Map<string, InstalledMod[]>();
  for (const m of mods) {
    const id = metaOf.get(m.id)?.id;
    if (!id) continue;
    byModId.set(id.toLowerCase(), [...(byModId.get(id.toLowerCase()) ?? []), m]);
  }
  for (const [modId, group] of byModId) {
    pushDup(group, `одинаковый mod-id «${modId}»`, { byModId: true, modId });
  }

  // Устаревшие — через checkUpdates (сеть), ошибки сети не ломают проверку.
  try {
    const updates = await checkUpd(instance.id);
    for (const u of updates) {
      const m = mods.find((x) => x.id === u.modId);
      if (!m) continue;
      issues.push(
        mk(
          'outdated',
          `«${m.name}» устарел: ${m.version} → ${u.latest.versionNumber}`,
          `В каталоге вышла новая версия мода «${m.name}».`,
          `Обновить мод до ${u.latest.versionNumber} (старая версия будет в бэкапе).`,
          'Новая версия мода может менять поведение или требовать обновления зависимостей.',
          'high',
          true,
          { modId: m.id, via: m.fileName, latestVersionId: u.latest.id, latestVersionNumber: u.latest.versionNumber }
        )
      );
    }
  } catch {
    /* сеть недоступна — пропустим проверки обновлений */
  }
  return issues;
}

export type AutoFixActionType =
  | 'install-dependency'
  | 'update-mod'
  | 'replace-version'
  | 'remove-duplicate'
  | 'disable-mod'
  | 'manual';

export interface AutoFixAction {
  issueId: string;
  action: AutoFixActionType;
  description: string;
  payload: Record<string, unknown>;
}

/**
 * Помощник при сборке: выбирает только безопасные автоматические действия.
 * Всё, что требует решений (смена версии/загрузчика, конфликты с потерей
 * функций), уходит в `manual`.
 */
export function planAutoFix(issues: BuildIssue[]): AutoFixAction[] {
  const actions: AutoFixAction[] = [];
  for (const issue of issues) {
    if (issue.fixable && issue.confidence !== 'low') {
      switch (issue.kind) {
        case 'missing': {
          const projectId = issue.payload.depProjectId;
          const source = issue.payload.source;
          if (typeof projectId === 'string' && typeof source === 'string') {
            actions.push({
              issueId: issue.id,
              action: 'install-dependency',
              description: `Установить «${projectId}» из каталога`,
              payload: { projectId, source, versionId: issue.payload.versionId }
            });
            continue;
          }
          break;
        }
        case 'outdated':
          actions.push({
            issueId: issue.id,
            action: 'update-mod',
            description: `Обновить до ${String(issue.payload.latestVersionNumber ?? 'последней версии')}`,
            payload: { modId: issue.payload.modId, latestVersionId: issue.payload.latestVersionId }
          });
          continue;
        case 'duplicate':
          actions.push({
            issueId: issue.id,
            action: 'remove-duplicate',
            description: 'Удалить дубликаты, оставить один файл',
            payload: { keep: issue.payload.keep, remove: issue.payload.remove }
          });
          continue;
        case 'conflict':
          if (typeof issue.payload.disableId === 'string') {
            actions.push({
              issueId: issue.id,
              action: 'disable-mod',
              description: 'Выключить конфликтующий мод',
              payload: { modId: issue.payload.disableId }
            });
            continue;
          }
          break;
        case 'incompatible':
          if (issue.payload.replace) {
            actions.push({
              issueId: issue.id,
              action: 'replace-version',
              description: 'Заменить на версию для этой версии игры',
              payload: { modId: issue.payload.modId }
            });
            continue;
          }
          break;
        default:
          break;
      }
    }
    actions.push({ issueId: issue.id, action: 'manual', description: issue.explanation, payload: issue.payload });
  }
  return actions;
}
