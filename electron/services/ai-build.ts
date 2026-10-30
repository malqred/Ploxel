import type { CatalogProject, CatalogSearchQuery, CatalogSearchResult, CatalogVersion, Instance, InstalledMod } from '../../shared/types';
import { draftBuild, draftImprove, MOD_COUNT, type AiBuildDraft, type ModCountRange } from './ai';
import { findTwin, projectKey } from '../core/project-match';
import { getModrinthProjectBriefs, searchModrinth, type ProjectBrief } from './modrinth';
import { listVersions } from './versions';
import { catalogVersions } from './catalog';
import { createInstance, readInstance } from './instances';
import { applyKeybindsOnCreate } from './keybinds';
import * as mods from './mods';
import { buildPlan, checkBuild, installPlan } from './dependencies';
import { createTask, finishTask, isTaskCancelled, updateTask } from './downloader';
import { emit } from './events';

/**
 * Подбор сборки с ИИ: модель называет проекты, лаунчер находит каждый на
 * Modrinth под нужные версию игры и загрузчик. Выдуманные или неподходящие
 * названия отбрасываются, дубли по назначению — тоже. Сама сборка ставится в
 * фоне: прогресс виден в карточке загрузок слева, а после установки лаунчер
 * прогоняет «Проверку сборки» и убирает несовместимое.
 */

export type AiPickKind = 'mod' | 'resourcepack' | 'shader';
export type AiLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge';
export interface AiPickItem {
  project: CatalogProject;
  kind: AiPickKind;
  reason?: string;
}
export interface AiBuildPick {
  gameVersion: string;
  loader: AiLoader;
  name?: string;
  summary?: string;
  items: AiPickItem[];
  /** названия, которых нет на Modrinth для этой версии */
  missing: string[];
  /** убранные дубли: «REI — дублирует JEI» */
  dropped: string[];
}
export interface AiPickInput {
  text: string;
  gameVersion?: string;
  loader?: AiLoader;
  count?: ModCountRange;
}

const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'] as const;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** Моды с одной задачей: в сборке остаётся первый из названных ИИ (slug Modrinth или CurseForge). */
export const FAMILIES: string[][] = [
  ['jei', 'rei', 'emi'],
  ['xaeros-minimap', 'journeymap', 'voxelmap-updated', 'ftb-chunks-fabric'],
  ['sodium', 'embeddium', 'rubidium'],
  ['iris', 'oculus'],
  ['jade', 'wthit', 'the-one-probe'],
  ['lithium', 'canary', 'radium'],
  ['xaeros-world-map', 'journeymap'],
  ['shoulder-surfing-reloaded', 'better-third-person']
];

/** Лучшее совпадение по названию; null — если результаты явно про другое. */
export function bestMatch(name: string, hits: CatalogProject[]): CatalogProject | null {
  const n = norm(name);
  if (!n) return null;
  const exact = hits.find((h) => norm(h.title) === n || norm(h.slug) === n);
  if (exact) return exact;
  // Вхождение считается, только если названия сопоставимы по длине:
  // «Effective» не должен совпасть с «PurpurPack's Pickaxe Effective …»
  const contains = hits.find((h) => {
    const t = norm(h.title);
    const ratio = Math.min(t.length, n.length) / Math.max(t.length, n.length);
    return t.length > 2 && ratio >= 0.5 && (t.includes(n) || n.includes(t));
  });
  if (contains) return contains;
  const want = words(name);
  if (!want.length || !hits[0]) return null;
  const titleWords = words(hits[0].title);
  const have = new Set([...titleWords, ...words(hits[0].slug)]);
  const matched = want.filter((w) => have.has(w)).length;
  // Совпасть должна заметная часть слов с обеих сторон
  return matched / want.length >= 0.6 && matched / Math.max(1, titleWords.length) >= 0.5 ? hits[0] : null;
}

/** Убирает моды, которые дублируют уже выбранный мод той же задачи. */
export function dropDuplicates(items: AiPickItem[]): { items: AiPickItem[]; dropped: string[] } {
  const taken = new Map<number, AiPickItem>();
  const dropped: string[] = [];
  const out: AiPickItem[] = [];
  for (const item of items) {
    const fam = FAMILIES.findIndex((f) => f.includes(item.project.slug));
    if (fam >= 0 && item.kind === 'mod') {
      const first = taken.get(fam);
      if (first) {
        dropped.push(`${item.project.title} — дублирует ${first.project.title}`);
        continue;
      }
      taken.set(fam, item);
    }
    out.push(item);
  }
  return { items: out, dropped };
}

type Search = (q: CatalogSearchQuery) => Promise<CatalogSearchResult>;

/** Каталоги для ИИ-подбора: Modrinth всегда, CurseForge — если задан ключ. */
async function defaultSearches(): Promise<Search[]> {
  const { isCurseForgeAvailable, searchCurseForge } = await import('./curseforge');
  return isCurseForgeAvailable() ? [searchModrinth, searchCurseForge] : [searchModrinth];
}

export async function resolveDraft(
  draft: AiBuildDraft,
  fallbackVersion: string,
  search?: Search | Search[]
): Promise<AiBuildPick> {
  const searches = search ? (Array.isArray(search) ? search : [search]) : await defaultSearches();
  const gameVersion = draft.gameVersion && /^\d+(\.\d+)+$|^\d{2}w\d{2}[a-z]$/.test(draft.gameVersion) ? draft.gameVersion : fallbackVersion;
  const loader = (LOADERS as readonly string[]).includes(draft.loader ?? '') ? (draft.loader as AiLoader) : 'fabric';

  const wanted: { name: string; reason?: string; kind: AiPickKind }[] = [
    ...draft.mods.map((m) => ({ ...m, kind: 'mod' as const })),
    ...draft.resourcepacks.map((m) => ({ ...m, kind: 'resourcepack' as const })),
    ...draft.shaders.map((m) => ({ ...m, kind: 'shader' as const }))
  ];
  // Шейдерам нужен загрузчик шейдеров — даже если ИИ про него забыл
  if (draft.shaders.length && !draft.mods.some((m) => /iris|oculus/i.test(m.name))) {
    wanted.unshift({ name: loader === 'forge' ? 'Oculus' : 'Iris Shaders', kind: 'mod', reason: undefined });
  }

  const found: (AiPickItem | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const idx = next++;
      const w = wanted[idx];
      // Сначала Modrinth; если проекта там нет под эту версию — следующий каталог
      for (const [i, run] of searches.entries()) {
        try {
          const res = await run({
            source: i === 0 ? 'modrinth' : 'curseforge',
            projectType: w.kind,
            query: w.name,
            gameVersion,
            loader: w.kind === 'mod' ? loader : undefined,
            sort: 'relevance',
            offset: 0,
            limit: 6
          });
          const hit = bestMatch(w.name, res.hits);
          if (hit) {
            found[idx] = { project: hit, kind: w.kind, reason: w.reason };
            break;
          }
        } catch {
          /* сеть или каталог недоступен — пробуем следующий */
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const seen = new Set<string>();
  const unique: AiPickItem[] = [];
  const missing: string[] = [];
  found.forEach((item, idx) => {
    if (!item) {
      missing.push(wanted[idx].name);
      return;
    }
    const key = projectKey(item.project.title);
    if (seen.has(item.project.id) || seen.has(key)) return;
    seen.add(item.project.id);
    seen.add(key);
    unique.push(item);
  });
  const { items, dropped } = dropDuplicates(unique);
  return { gameVersion, loader, name: draft.name, summary: draft.summary, items, missing, dropped };
}

async function latestRelease(): Promise<string> {
  const latest = await listVersions(false)
    .then((v) => v.latest?.release || v.versions[0]?.id)
    .catch(() => undefined);
  return latest || '1.21.1';
}

export async function pickBuild(input: AiPickInput | string): Promise<AiBuildPick> {
  const req: AiPickInput = typeof input === 'string' ? { text: input } : input;
  const gameVersion = req.gameVersion || (await latestRelease());
  const loader: AiLoader = req.loader && (LOADERS as readonly string[]).includes(req.loader) ? req.loader : 'fabric';
  const count: ModCountRange = req.count && req.count in MOD_COUNT ? req.count : '0-20';
  const draft = await draftBuild(req.text, { gameVersion, loader, count });
  const pick = await resolveDraft({ ...draft, gameVersion, loader }, gameVersion);
  if (!pick.items.length) throw new Error('ИИ не назвал ни одного проекта, который есть на Modrinth для этой версии. Уточните запрос.');
  return pick;
}

/* ------------------------------ Фоновая сборка ------------------------------ */

export interface AssembleItem {
  projectId: string;
  /** каталог проекта; без поля — Modrinth (старые вызовы) */
  source?: 'modrinth' | 'curseforge';
  kind: AiPickKind;
  title: string;
  iconUrl?: string;
}
export interface AssembleSpec {
  name: string;
  gameVersion: string;
  loader: AiLoader;
  memoryMb?: number;
  items: AssembleItem[];
}
export interface AssembleReport {
  instanceId: string;
  name: string;
  installed: number;
  total: number;
  failed: string[];
  /** убрано из-за несовместимости: «X — причина» */
  removed: string[];
  cancelled: boolean;
  /** улучшение уже существующей сборки («Улучшить с ИИ») */
  improved?: boolean;
}

/**
 * Пары, которые Modrinth помечает как несовместимые (dependency_type
 * incompatible): из пары остаётся тот, что выше в списке.
 */
export function dropIncompatible(
  list: { item: AssembleItem; version: CatalogVersion }[]
): { kept: { item: AssembleItem; version: CatalogVersion }[]; removed: string[] } {
  const kept: { item: AssembleItem; version: CatalogVersion }[] = [];
  const removed: string[] = [];
  for (const entry of list) {
    const clash = kept.find(
      (k) =>
        k.version.dependencies.some((d) => d.type === 'incompatible' && d.projectId === entry.item.projectId) ||
        entry.version.dependencies.some((d) => d.type === 'incompatible' && d.projectId === k.item.projectId)
    );
    if (clash) {
      removed.push(`${entry.item.title} — несовместим с ${clash.item.title}`);
      continue;
    }
    kept.push(entry);
  }
  return { kept, removed };
}

/** Создаёт сборку сразу, а моды ставит в фоне. Итог приходит событием ai:assembled. */
export async function startAssemble(spec: AssembleSpec): Promise<Instance> {
  const instance = await createInstance({
    name: spec.name,
    gameVersion: spec.gameVersion,
    loader: { kind: spec.loader },
    memoryMb: spec.memoryMb
  });
  applyKeybindsOnCreate(instance.id, instance.gameVersion);
  void assemble(instance, spec).then(
    (report) => emit('ai:assembled', report),
    (e) =>
      emit('ai:assembled', {
        instanceId: instance.id,
        name: instance.name,
        installed: 0,
        total: spec.items.length,
        failed: [e instanceof Error ? e.message : String(e)],
        removed: [],
        cancelled: false
      } satisfies AssembleReport)
  );
  return instance;
}

export async function assemble(instance: Instance, spec: AssembleSpec, improve = false): Promise<AssembleReport> {
  const total = spec.items.length;
  const taskId = createTask(improve ? `Улучшение «${instance.name}»` : `Сборка «${instance.name}»`, 'Подбор версий');
  // Что было в сборке до установки: при улучшении эти моды не трогаем никогда
  const before = new Set(mods.scanMods(instance.id).map((m) => m.id));
  updateTask(taskId, { status: 'running', total, done: 0, canCancel: true });
  const failed: string[] = [];
  const removed: string[] = [];
  const changed = () => emit('instance:modsChanged', { instanceId: instance.id });
  const report = (installed: number, cancelled: boolean): AssembleReport => ({
    instanceId: instance.id,
    name: instance.name,
    installed,
    total,
    failed,
    removed,
    cancelled,
    improved: improve
  });

  // 1. Версия каждого проекта под эту игру и загрузчик
  const resolved: ({ item: AssembleItem; version: CatalogVersion } | null)[] = new Array(total).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < total) {
        const idx = next++;
        const item = spec.items[idx];
        try {
          const versions = await catalogVersions(item.source ?? 'modrinth', item.projectId, spec.gameVersion, item.kind === 'mod' ? spec.loader : undefined);
          if (versions[0]) resolved[idx] = { item, version: versions[0] };
          else removed.push(`${item.title} — нет версии для ${spec.gameVersion}`);
        } catch (e) {
          console.warn('[ai-build] версии не получены:', item.title, e instanceof Error ? e.message : e);
          failed.push(item.title);
        }
      }
    })
  );

  // 2. Несовместимые пары по данным Modrinth
  const { kept, removed: clashes } = dropIncompatible(resolved.filter((x): x is NonNullable<typeof x> => !!x));
  removed.push(...clashes);

  // 3. Установка по одной: общие зависимости не качаются дважды
  let installed = 0;
  for (let i = 0; i < kept.length; i++) {
    if (isTaskCancelled(taskId)) {
      finishTask(taskId);
      changed();
      return report(installed, true);
    }
    const { item, version } = kept[i];
    updateTask(taskId, { done: i, total: kept.length, detail: item.title });
    try {
      await mods.installProject(instance, item.source ?? 'modrinth', item.projectId, item.kind as InstalledMod['kind'], {
        versionId: version.id,
        projectName: item.title,
        projectIcon: item.iconUrl,
        withDependencies: true
      });
      installed++;
      if (i % 5 === 4) changed();
    } catch (e) {
      console.warn('[ai-build] не установлен:', item.title, e instanceof Error ? e.message : e);
      failed.push(item.title);
    }
  }

  // 4. Та же проверка, что «Проверить сборку»: несовместимое убираем,
  //    недостающие зависимости докачиваем
  updateTask(taskId, { done: kept.length, detail: 'Проверка совместимости' });
  try {
    for (let pass = 0; pass < 2; pass++) {
      const issues = await checkBuild(instance);
      const all = mods.scanMods(instance.id);
      const nameOf = (id: unknown) => all.find((m) => m.id === id)?.name ?? String(id);
      const isNew = (id: unknown) => typeof id === 'string' && !before.has(id) && all.some((m) => m.id === id);
      let touched = false;
      for (const issue of issues) {
        const p = issue.payload;
        // Из пары конфликтующих при улучшении убираем только что добавленный мод
        const conflictTarget =
          issue.kind !== 'conflict'
            ? undefined
            : improve
              ? [...(Array.isArray(p.modIds) ? (p.modIds as unknown[]) : []), p.disableId].find(isNew)
              : typeof p.disableId === 'string' && all.some((m) => m.id === p.disableId)
                ? p.disableId
                : undefined;
        if (issue.kind === 'missing' && improve && !isNew(p.modId)) continue;
        if (typeof conflictTarget === 'string') {
          removed.push(`${nameOf(conflictTarget)} — ${issue.title}`);
          await mods.removeMod(instance.id, conflictTarget);
          touched = true;
        } else if (issue.kind === 'incompatible' && typeof p.modId === 'string' && (improve ? isNew(p.modId) : all.some((m) => m.id === p.modId))) {
          removed.push(`${nameOf(p.modId)} — ${issue.explanation}`);
          await mods.removeMod(instance.id, p.modId);
          touched = true;
        } else if (issue.kind === 'missing' && issue.fixable && typeof p.depProjectId === 'string') {
          try {
            const depSource = p.source === 'curseforge' ? 'curseforge' : 'modrinth';
            const plan = await buildPlan(instance, depSource, p.depProjectId, p.versionId as string | undefined);
            await installPlan(instance, plan, plan.items.filter((x) => x.selected).map((x) => x.key));
            touched = true;
          } catch {
            /* не вышло — останется в «Проверке сборки» */
          }
        }
      }
      if (!touched) break;
    }
  } catch {
    /* без сети проверка повторится вручную */
  }

  finishTask(taskId);
  changed();
  return report(installed, false);
}

/* ------------------------------ «Улучшить с ИИ» ------------------------------ */

/** Подбор новых модов для существующей сборки по пожеланию пользователя. */
export async function pickImprove(instanceId: string, text: string): Promise<AiBuildPick> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  if (instance.loader.kind === 'vanilla') {
    throw new Error('В сборке без загрузчика моды не работают — создайте сборку с Fabric, Forge, NeoForge или Quilt.');
  }
  const loader = instance.loader.kind as AiLoader;
  const installed = mods.scanMods(instanceId);
  const ids = installed.filter((m) => m.source === 'modrinth' && m.projectId).map((m) => m.projectId!);
  const briefs: Record<string, ProjectBrief> = ids.length ? await getModrinthProjectBriefs(ids).catch(() => ({})) : {};
  const draft = await draftImprove(text, {
    gameVersion: instance.gameVersion,
    loader,
    installed: installed.map((m) => (m.projectId && briefs[m.projectId]?.title) || m.name)
  });
  const pick = await resolveDraft({ ...draft, gameVersion: instance.gameVersion, loader }, instance.gameVersion);
  // Уже установленное и моды той же задачи, что у установленных, убираем
  const have = new Set(installed.map((m) => m.projectId).filter(Boolean) as string[]);
  const haveSlugs = new Set(Object.values(briefs).map((b) => b.slug));
  // Мод мог стоять из CurseForge, а ИИ нашёл его на Modrinth (и наоборот) — сравниваем и по названию
  const named = installed.map((m) => ({ ...m, name: (m.projectId && briefs[m.projectId]?.title) || m.name }));
  const dropped = [...pick.dropped];
  const items = pick.items.filter((item) => {
    if (have.has(item.project.id)) return false;
    if (findTwin(item.project, named) || findTwin(item.project, installed)) {
      dropped.push(`${item.project.title} — уже есть в сборке`);
      return false;
    }
    const fam = FAMILIES.find((f) => f.includes(item.project.slug));
    const twin = fam?.find((slug) => slug !== item.project.slug && haveSlugs.has(slug));
    if (twin) {
      dropped.push(`${item.project.title} — в сборке уже есть ${twin}`);
      return false;
    }
    return true;
  });
  if (!items.length) {
    throw new Error('ИИ не нашёл, что добавить: всё подходящее уже есть в сборке или не нашлось на Modrinth. Уточните запрос.');
  }
  return { ...pick, items, dropped };
}

/** Ставит выбранные моды в существующую сборку в фоне. Итог — событие ai:assembled. */
export function startImprove(instanceId: string, items: AssembleItem[]): { ok: true } {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const loader = instance.loader.kind as AiLoader;
  const spec: AssembleSpec = { name: instance.name, gameVersion: instance.gameVersion, loader, items };
  void assemble(instance, spec, true).then(
    (report) => emit('ai:assembled', report),
    (e) =>
      emit('ai:assembled', {
        instanceId,
        name: instance.name,
        installed: 0,
        total: items.length,
        failed: [e instanceof Error ? e.message : String(e)],
        removed: [],
        cancelled: false,
        improved: true
      } satisfies AssembleReport)
  );
  return { ok: true };
}
