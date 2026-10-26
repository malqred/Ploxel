import type { CatalogProject, CatalogSearchQuery, CatalogSearchResult, CatalogVersion } from '../../shared/types';
import { stripHtml, stripRichBlocks } from '../core/text';

const BASE = 'https://api.modrinth.com/v2';
const UA = 'PloxelLauncher/0.1 (local, non-commercial launcher)';

const LOADER_CATEGORY: Record<string, string> = {
  fabric: 'fabric',
  forge: 'forge',
  neoforge: 'neoforge',
  quilt: 'quilt'
};

async function get<T>(url: string, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429) {
        // Лимит Modrinth — 300 запросов в минуту; ждём, сколько сказал сервер
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        await new Promise((r) => setTimeout(r, Math.min(60, reset > 0 ? reset + 1 : 2 * (i + 1)) * 1000));
        last = new Error('Modrinth: слишком много запросов, попробуйте позже');
        continue;
      }
      if (!res.ok) throw new Error(`Modrinth: HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error('Modrinth недоступен');
}

interface RawHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  author: string;
  categories: string[];
  project_type: string;
  versions: string[];
  date_modified: string;
}

function normalizeType(t: string): CatalogProject['projectType'] {
  if (t === 'modpack') return 'modpack';
  if (t === 'resourcepack') return 'resourcepack';
  if (t === 'shader') return 'shader';
  return 'mod';
}

export async function searchModrinth(q: CatalogSearchQuery): Promise<CatalogSearchResult> {
  const facets: string[][] = [[`project_type:${q.projectType}`]];
  if (q.gameVersion) facets.push([`versions:${q.gameVersion}`]);
  if (q.loader && q.projectType === 'mod' && LOADER_CATEGORY[q.loader]) {
    facets.push([`categories:${LOADER_CATEGORY[q.loader]}`]);
  }
  if (q.category) facets.push([`categories:${q.category}`]);
  const params = new URLSearchParams({
    query: q.query,
    facets: JSON.stringify(facets),
    index: q.sort === 'follows' ? 'follows' : q.sort,
    offset: String(q.offset),
    limit: String(q.limit)
  });
  const res = await get<{ hits: RawHit[]; total_hits: number; offset: number; limit: number }>(
    `${BASE}/search?${params.toString()}`
  );
  return {
    total: res.total_hits,
    offset: res.offset,
    limit: res.limit,
    hits: res.hits.map((h) => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: stripHtml(h.description),
      iconUrl: h.icon_url,
      downloads: h.downloads,
      author: h.author,
      categories: h.categories,
      projectType: normalizeType(h.project_type),
      loaders: h.categories.filter((c) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(c)),
      gameVersions: h.versions,
      updatedAt: h.date_modified,
      url: `https://modrinth.com/${h.project_type}/${h.slug}`
    }))
  };
}

export async function getModrinthVersions(projectId: string, gameVersion?: string, loader?: string): Promise<CatalogVersion[]> {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loader && LOADER_CATEGORY[loader]) params.set('loaders', JSON.stringify([LOADER_CATEGORY[loader]]));
  const list = await get<RawVersion[]>(`${BASE}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`);
  // Для модпаков Modrinth фильтр loaders не применяет — дофильтровываем сами
  const wanted = loader ? LOADER_CATEGORY[loader] : undefined;
  return list.filter((v) => !wanted || !v.loaders.length || v.loaders.includes(wanted)).map(normalizeVersion);
}

interface RawVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: {
    url: string;
    filename: string;
    size: number;
    primary: boolean;
    hashes: { sha1?: string; sha512?: string };
  }[];
  dependencies: { version_id?: string; project_id?: string; dependency_type: string }[];
  date_published: string;
  changelog?: string;
}

function normalizeVersion(v: RawVersion): CatalogVersion {
  return {
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    files: v.files.map((f) => ({
      url: f.url,
      fileName: f.filename,
      size: f.size,
      primary: f.primary,
      hashes: f.hashes.sha1 ? { sha1: f.hashes.sha1 } : undefined
    })),
    dependencies: v.dependencies
      .filter((d) => d.project_id)
      .map((d) => ({
        projectId: d.project_id!,
        versionId: d.version_id,
        required: d.dependency_type === 'required',
        type: d.dependency_type
      })),
    datePublished: v.date_published,
    changelog: v.changelog
  };
}

export async function getModrinthProject(id: string): Promise<CatalogProject | null> {
  const p = await get<
    Omit<RawHit, 'project_id'> & {
      id?: string;
      project_id?: string;
      body?: string;
      gallery?: { url: string }[];
    }
  >(`${BASE}/project/${encodeURIComponent(id)}`);
  const projectId = p?.project_id ?? p?.id;
  if (!projectId) return null;
  return {
    source: 'modrinth',
    id: projectId,
    slug: p.slug,
    title: p.title,
    description: stripHtml(p.description),
    iconUrl: p.icon_url,
    downloads: p.downloads,
    author: p.author,
    categories: p.categories,
    projectType: normalizeType(p.project_type),
    loaders: p.categories.filter((c) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(c)),
    gameVersions: p.versions ?? [],
    updatedAt: p.date_modified,
    url: `https://modrinth.com/${p.project_type}/${p.slug}`,
    body: p.body ? stripRichBlocks(p.body) : p.body,
    gallery: (p.gallery ?? []).map((g) => g.url).slice(0, 6)
  };
}

/**
 * Проверка обновлений по хэшам (Modrinth умеет батчем). Без фильтра Modrinth
 * вернёт самую свежую версию под любую игру и загрузчик — поэтому версию игры
 * и загрузчик сборки передаём всегда.
 */
export async function checkModrinthUpdates(
  hashes: string[],
  filter: { gameVersions?: string[]; loaders?: string[] } = {}
): Promise<Record<string, CatalogVersion | null>> {
  if (!hashes.length) return {};
  const body: Record<string, unknown> = { hashes, algorithm: 'sha1' };
  if (filter.gameVersions?.length) body.game_versions = filter.gameVersions;
  if (filter.loaders?.length) body.loaders = filter.loaders;
  const res = await fetch(`${BASE}/version_files/update`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Modrinth: HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, RawVersion>;
  const out: Record<string, CatalogVersion | null> = {};
  for (const hash of hashes) out[hash] = json[hash] ? normalizeVersion(json[hash]) : null;
  return out;
}

export interface IdentifiedFile {
  projectId: string;
  versionId: string;
  versionNumber: string;
  title: string;
  iconUrl?: string;
  dependencies: CatalogVersion['dependencies'];
}

/**
 * Распознаёт файлы по SHA1: какой это проект Modrinth, версия, название и
 * иконка. Нужен для модов, добавленных вручную или импортированных из
 * других лаунчеров, — после этого у них появляются иконки и обновления.
 */
export async function identifyModrinthFiles(hashes: string[]): Promise<Record<string, IdentifiedFile>> {
  const out: Record<string, IdentifiedFile> = {};
  if (!hashes.length) return out;
  const res = await fetch(`${BASE}/version_files`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes, algorithm: 'sha1' })
  });
  if (!res.ok) throw new Error(`Modrinth: HTTP ${res.status}`);
  const versions = (await res.json()) as Record<string, RawVersion>;
  const ids = [...new Set(Object.values(versions).map((v) => v.project_id))];
  const projects = new Map<string, { title: string; icon_url?: string }>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const list = await get<{ id: string; title: string; icon_url?: string }[]>(
      `${BASE}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`
    );
    for (const p of list) projects.set(p.id, p);
  }
  for (const [hash, v] of Object.entries(versions)) {
    const project = projects.get(v.project_id);
    out[hash] = {
      projectId: v.project_id,
      versionId: v.id,
      versionNumber: v.version_number,
      title: project?.title ?? v.name,
      iconUrl: project?.icon_url ?? undefined,
      dependencies: normalizeVersion(v).dependencies
    };
  }
  return out;
}

/** Версии по id одним запросом: для каких версий игры и загрузчиков файл. */
export async function getModrinthVersionsByIds(ids: string[]): Promise<Record<string, { gameVersions: string[]; loaders: string[] }>> {
  const out: Record<string, { gameVersions: string[]; loaders: string[] }> = {};
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const list = await get<RawVersion[]>(`${BASE}/versions?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    for (const v of list) out[v.id] = { gameVersions: v.game_versions, loaders: v.loaders };
  }
  return out;
}

/** Поиск версии по SHA1 файла — для экспорта и проверки обновлений. */
export async function getModrinthVersionByHash(sha1: string): Promise<CatalogVersion | null> {
  try {
    const v = await get<RawVersion>(`${BASE}/version_file/${sha1}?algorithm=sha1`);
    return v?.id ? normalizeVersion(v) : null;
  } catch {
    return null;
  }
}

export const MODRINTH_CATEGORIES = {
  mod: [
    { id: 'adventure', label: 'Приключения' },
    { id: 'decoration', label: 'Украшения' },
    { id: 'equipment', label: 'Снаряжение' },
    { id: 'food', label: 'Еда' },
    { id: 'magic', label: 'Магия' },
    { id: 'optimization', label: 'Оптимизация' },
    { id: 'technology', label: 'Технологии' },
    { id: 'worldgen', label: 'Генерация мира' },
    { id: 'library', label: 'Библиотеки' }
  ],
  resourcepack: [
    { id: 'realistic', label: 'Реалистичные' },
    { id: 'medieval', label: 'Средневековые' },
    { id: 'simplistic', label: 'Минимализм' },
    { id: 'themed', label: 'Тематические' }
  ],
  shader: [
    { id: 'realistic', label: 'Реалистичные' },
    { id: 'lighting', label: 'Освещение' },
    { id: 'cartoon', label: 'Мультяшные' }
  ],
  modpack: [
    { id: 'adventure', label: 'Приключения' },
    { id: 'optimization', label: 'Оптимизация' },
    { id: 'technology', label: 'Технологии' }
  ]
};

export interface ProjectBrief {
  slug: string;
  title: string;
  categories: string[];
}

const briefCache = new Map<string, ProjectBrief>();

/** Краткие данные проектов пачкой (slug, название, категории) — для фильтров и ИИ. */
export async function getModrinthProjectBriefs(ids: string[]): Promise<Record<string, ProjectBrief>> {
  const out: Record<string, ProjectBrief> = {};
  const missing = [...new Set(ids)].filter((id) => {
    const hit = briefCache.get(id);
    if (hit) out[id] = hit;
    return !hit;
  });
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const list = await get<{ id: string; slug: string; title: string; categories: string[]; additional_categories?: string[] }[]>(
      `${BASE}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`
    );
    for (const p of list) {
      const brief = { slug: p.slug, title: p.title, categories: [...p.categories, ...(p.additional_categories ?? [])] };
      briefCache.set(p.id, brief);
      out[p.id] = brief;
    }
  }
  return out;
}
