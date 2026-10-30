import { getConfig } from './config';
import { deleteSecret } from './secrets';
import { stripHtml } from '../core/text';
import type { CatalogProject, CatalogSearchQuery, CatalogSearchResult, CatalogVersion } from '../../shared/types';

const BASE = 'https://api.curseforge.com/v1';
const GAME_ID = 432;

export class CurseForgeUnavailable extends Error {
  code = 'NO_KEY';
  constructor() {
    super('CurseForge недоступен: в config.json не указан curseforgeApiKey.');
  }
}

const CLASS_ID: Record<CatalogSearchQuery['projectType'], number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552
};

const LOADER_ID: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const LOADER_BY_ID: Record<number, string> = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const KNOWN_LOADERS = new Set(['forge', 'fabric', 'quilt', 'neoforge']);
const TYPE_BY_CLASS: Record<number, CatalogProject['projectType']> = { 6: 'mod', 4471: 'modpack', 12: 'resourcepack', 6552: 'shader' };

/** «1.20.1» — версия игры; «Fabric», «Client», «Java 17» — нет. */
const isGameVersion = (v: string) => /^\d+\.\d+/.test(v);

// Ключ CurseForge берётся только из config.json / PLOXEL_CURSEFORGE_KEY.
// Ключ, сохранённый раньше через настройки, удаляется при запуске.
export function curseforgeKey(): string {
  const k = getConfig().curseforgeApiKey;
  if (!k) throw new CurseForgeUnavailable();
  return k;
}

export function hasCurseForgeKey(): boolean {
  return !!getConfig().curseforgeApiKey;
}

/** Убирает ключ CurseForge, сохранённый в старых версиях через настройки. */
export function forgetStoredCurseForgeKey(): void {
  try {
    deleteSecret('curseforge-key');
  } catch {
    /* файла нет — и хорошо */
  }
}

/** fetch через отдельное соединение (новый Agent undici); без undici — обычный fetch. */
async function freshFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const undici = (await import('undici')) as unknown as {
      Agent: new (o?: object) => { close(): Promise<void> };
      fetch: (u: string, i: object) => Promise<Response>;
    };
    const dispatcher = new undici.Agent({ keepAliveTimeout: 1, connections: 1 });
    try {
      const res = await undici.fetch(url, { ...init, dispatcher });
      // Тело читается позже — соединение закроется после этого само; Agent закрываем с запасом
      setTimeout(() => void dispatcher.close().catch(() => undefined), 30000);
      return res;
    } catch (e) {
      void dispatcher.close().catch(() => undefined);
      throw e;
    }
  } catch (e) {
    if (e instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(e.message)) return fetch(url, init);
    throw e;
  }
}

/**
 * Запрос к API с повтором: на нестабильной сети соединение иногда виснет,
 * а следующая попытка проходит за доли секунды. 403 (неверный ключ) и 404 не повторяем.
 */
async function request(path: string, init: { method?: string; body?: string; altPath?: string } = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Повтор — с запасной формой запроса, если она есть: зависший у сервера запрос не ждём второй раз
      const url = attempt % 2 === 1 && init.altPath ? init.altPath : path;
      const opts = {
        method: init.method ?? 'GET',
        body: init.body,
        headers: { 'x-api-key': curseforgeKey(), Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(attempt === 0 ? 8000 : 15000)
      };
      // Повторы — через новое соединение: общий пул keep-alive мог держать зависший сокет,
      // и все попытки ушли бы в него
      const res = attempt === 0 ? await fetch(`${BASE}${url}`, opts) : await freshFetch(`${BASE}${url}`, opts);
      if (res.ok) return res;
      if (res.status === 403) throw new Error('CurseForge отклонил ключ API (HTTP 403). Проверьте curseforgeApiKey в config.json.');
      if (res.status !== 429 && res.status < 500) throw new Error(`CurseForge: HTTP ${res.status}`);
      lastError = new Error(`CurseForge: HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof CurseForgeUnavailable || (e instanceof Error && e.message.startsWith('CurseForge'))) throw e;
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('CurseForge недоступен');
}

async function api<T>(path: string): Promise<T> {
  return (await (await request(path)).json()) as T;
}

interface CfMod {
  id: number;
  classId?: number;
  screenshots?: { url: string }[];
  latestFilesIndexes?: { gameVersion: string; modLoader?: number }[];
  name: string;
  slug: string;
  summary: string;
  logo?: { thumbnailUrl?: string };
  downloadCount: number;
  authors: { name: string }[];
  categories: { name: string }[];
  links?: { websiteUrl?: string };
  dateModified: string;
}

interface CfFile {
  id: number;
  displayName: string;
  fileName: string;
  releaseType: number;
  fileDate: string;
  downloadUrl: string | null;
  fileLength: number;
  hashes: { value: string; algo: number }[];
  dependencies: { modId: number; relationType: number }[];
  gameVersions: string[];
  isServerPack?: boolean;
}

export function isCurseForgeAvailable(): boolean {
  return hasCurseForgeKey();
}

export async function searchCurseForge(q: CatalogSearchQuery): Promise<CatalogSearchResult> {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_ID[q.projectType]),
    searchFilter: q.query,
    sortField: q.sort === 'downloads' ? '6' : q.sort === 'newest' ? '11' : q.sort === 'updated' ? '3' : '2',
    sortOrder: 'desc',
    index: String(q.offset),
    pageSize: String(q.limit)
  });
  if (q.gameVersion) params.set('gameVersion', q.gameVersion);
  const loaderId = q.loader ? LOADER_ID[q.loader] : undefined;
  if (loaderId) params.set('modLoaderType', String(loaderId));
  if (q.category) {
    const categoryId = await curseForgeCategoryId(q.projectType, q.category).catch(() => undefined);
    if (categoryId) params.set('categoryId', String(categoryId));
  }
  // Поиск с категорией у CurseForge иногда зависает, пока результат не попал в его кэш;
  // повтор отправляем с другой формой того же фильтра (categoryIds) — он отвечает сразу
  const alt = new URLSearchParams(params);
  if (alt.has('categoryId')) {
    alt.set('categoryIds', JSON.stringify([Number(alt.get('categoryId'))]));
    alt.delete('categoryId');
  }
  const res = (await (
    await request(`/mods/search?${params.toString()}`, { altPath: `/mods/search?${alt.toString()}` })
  ).json()) as { data: CfMod[]; pagination: { totalCount: number } };
  return {
    total: res.pagination.totalCount,
    offset: q.offset,
    limit: q.limit,
    hits: res.data.map((m) => normalizeMod(m, q.projectType))
  };
}

function normalizeMod(m: CfMod, fallbackType: CatalogProject['projectType']): CatalogProject {
  const type = (m.classId && TYPE_BY_CLASS[m.classId]) || fallbackType;
  const indexes = m.latestFilesIndexes ?? [];
  const loaders = [...new Set(indexes.map((i) => (i.modLoader ? LOADER_BY_ID[i.modLoader] : undefined)).filter(Boolean) as string[])];
  const gameVersions = [...new Set(indexes.map((i) => i.gameVersion).filter(isGameVersion))];
  const section = type === 'modpack' ? 'modpacks' : type === 'resourcepack' ? 'texture-packs' : type === 'shader' ? 'shaders' : 'mc-mods';
  return {
    source: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    title: m.name,
    description: stripHtml(m.summary),
    iconUrl: m.logo?.thumbnailUrl,
    downloads: m.downloadCount,
    author: m.authors?.[0]?.name ?? '',
    categories: m.categories?.map((c) => c.name) ?? [],
    projectType: type,
    loaders,
    gameVersions,
    updatedAt: m.dateModified,
    url: m.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/${section}/${m.slug}`,
    gallery: (m.screenshots ?? []).map((g) => g.url).slice(0, 6)
  };
}

export async function getCurseForgeProject(id: string): Promise<CatalogProject | null> {
  const res = await api<{ data: CfMod }>(`/mods/${id}`);
  if (!res.data) return null;
  const project = normalizeMod(res.data, 'mod');
  // Полное описание — отдельным запросом (HTML; страница проекта переводит его в markdown)
  const body = await api<{ data: string }>(`/mods/${id}/description`).then((r) => r.data).catch(() => undefined);
  return body ? { ...project, body } : project;
}

export async function getCurseForgeFiles(id: string, gameVersion?: string, loader?: string): Promise<CatalogVersion[]> {
  const params = new URLSearchParams();
  if (gameVersion) params.set('gameVersion', gameVersion);
  const loaderId = loader ? LOADER_ID[loader] : undefined;
  if (loaderId) params.set('modLoaderType', String(loaderId));
  params.set('pageSize', '50');
  const res = await api<{ data: CfFile[] }>(`/mods/${id}/files?${params.toString()}`);
  // Новые файлы — первыми: по первому проверяются обновления.
  // Серверные сборки модпаков (isServerPack) клиенту не подходят.
  return res.data
    .filter((f) => !f.isServerPack)
    .map((f) => normalizeFile(f, id))
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished));
}

/** Файл CurseForge → версия каталога. Без downloadUrl автор запретил стороннее скачивание. */
function normalizeFile(f: CfFile, projectId: string): CatalogVersion {
  const sha1 = f.hashes.find((h) => h.algo === 1)?.value;
  return {
    id: String(f.id),
    projectId,
    name: f.displayName,
    versionNumber: f.displayName,
    gameVersions: f.gameVersions.filter(isGameVersion),
    loaders: f.gameVersions.map((v) => v.toLowerCase()).filter((v) => KNOWN_LOADERS.has(v)),
    files: f.downloadUrl
      ? [{ url: f.downloadUrl, fileName: f.fileName, size: f.fileLength, primary: true, hashes: sha1 ? { sha1 } : undefined }]
      : [],
    dependencies: f.dependencies
      .filter((d) => [1, 2, 3, 5].includes(d.relationType))
      .map((d) => ({
        projectId: String(d.modId),
        required: d.relationType === 3,
        type: d.relationType === 1 ? 'embedded' : d.relationType === 2 ? 'optional' : d.relationType === 5 ? 'incompatible' : 'required'
      })),
    datePublished: f.fileDate
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return (await (await request(path, { method: 'POST', body: JSON.stringify(body) })).json()) as T;
}

export interface CurseForgeIdentified {
  projectId: string;
  versionId: string;
  versionNumber: string;
  title: string;
  iconUrl?: string;
  dependencies: CatalogVersion['dependencies'];
}

/**
 * Распознаёт файлы по отпечатку CurseForge (MurmurHash2): проект, файл,
 * название и иконка. Пара к identifyModrinthFiles — моды, добавленные
 * вручную или импортированные, получают иконки и обновления из CurseForge.
 */
export async function identifyCurseForgeFiles(fingerprints: number[]): Promise<Record<number, CurseForgeIdentified>> {
  const out: Record<number, CurseForgeIdentified> = {};
  if (!fingerprints.length) return out;
  const res = await post<{ data: { exactMatches: { id: number; file: CfFile & { modId: number; fileFingerprint: number } }[] } }>(
    `/fingerprints/${GAME_ID}`,
    { fingerprints }
  );
  const matches = res.data?.exactMatches ?? [];
  const mods = new Map((await getCurseForgeMods(matches.map((m) => String(m.id)))).map((p) => [p.id, p]));
  for (const m of matches) {
    const project = mods.get(String(m.id));
    const version = normalizeFile(m.file, String(m.id));
    out[m.file.fileFingerprint] = {
      projectId: String(m.id),
      versionId: String(m.file.id),
      versionNumber: m.file.displayName,
      title: project?.title ?? m.file.displayName,
      iconUrl: project?.iconUrl,
      dependencies: version.dependencies
    };
  }
  return out;
}

/** Файлы по id пачкой: для каких версий игры и загрузчиков каждый файл. */
export async function getCurseForgeFilesByIds(ids: string[]): Promise<Record<string, { gameVersions: string[]; loaders: string[] }>> {
  const out: Record<string, { gameVersions: string[]; loaders: string[] }> = {};
  const numeric = ids.map(Number).filter(Number.isFinite);
  for (let i = 0; i < numeric.length; i += 100) {
    const res = await post<{ data: (CfFile & { modId: number })[] }>('/mods/files', { fileIds: numeric.slice(i, i + 100) });
    for (const f of res.data ?? []) {
      const v = normalizeFile(f, String(f.modId));
      out[String(f.id)] = { gameVersions: v.gameVersions, loaders: v.loaders };
    }
  }
  return out;
}

/** Ссылки на файлы модпака пачкой: имя, адрес (null — автор запретил сторонние загрузки), SHA1, размер. */
export async function getCurseForgeFileDownloads(
  fileIds: number[]
): Promise<Record<number, { fileName: string; downloadUrl: string | null; sha1?: string; size: number }>> {
  const out: Record<number, { fileName: string; downloadUrl: string | null; sha1?: string; size: number }> = {};
  for (let i = 0; i < fileIds.length; i += 100) {
    const res = await post<{ data: CfFile[] }>('/mods/files', { fileIds: fileIds.slice(i, i + 100) });
    for (const f of res.data ?? []) {
      out[f.id] = { fileName: f.fileName, downloadUrl: f.downloadUrl, sha1: f.hashes.find((h) => h.algo === 1)?.value, size: f.fileLength };
    }
  }
  return out;
}

/* ------------------------------ Категории ------------------------------ */

/**
 * Категории каталога в лаунчере общие (как у Modrinth). Для CurseForge их id
 * берём из его же списка категорий по slug — так фильтр работает одинаково
 * в обоих каталогах. Неизвестная категория просто не фильтрует.
 */
const CF_CATEGORY_SLUGS: Record<string, string[]> = {
  adventure: ['adventure-rpg', 'adventure-and-rpg'],
  cursed: ['mc-miscellaneous'],
  decoration: ['cosmetic', 'mc-addons'],
  economy: ['server-utility'],
  equipment: ['armor-weapons-tools'],
  food: ['mc-food'],
  'game-mechanics': ['mc-miscellaneous'],
  library: ['library-api'],
  magic: ['magic'],
  management: ['server-utility'],
  minigame: ['mc-miscellaneous'],
  mobs: ['mc-mobs'],
  optimization: ['performance', 'small-light'],
  social: ['server-utility'],
  storage: ['storage'],
  technology: ['technology', 'tech'],
  transportation: ['player-transport'],
  utility: ['utility-qol'],
  worldgen: ['world-gen'],
  // ресурспаки и шейдеры
  '16x': ['16x'],
  '32x': ['32x'],
  realistic: ['photo-realistic'],
  simplistic: ['traditional'],
  themed: ['steampunk', 'medieval', 'modern'],
  vanilla: ['vanilla'],
  medieval: ['medieval'],
  lighting: ['realistic', 'photo-realistic'],
  'vanilla-like': ['vanilla'],
  fantasy: ['fantasy'],
  'semi-realistic': ['photo-realistic'],
  cartoon: ['traditional'],
  // модпаки
  'kitchen-sink': ['multiplayer'],
  lightweight: ['small-light'],
  quests: ['quests'],
  'tech': ['tech'],
  combat: ['combat-pvp'],
  multiplayer: ['multiplayer'],
  challenging: ['hardcore']
};

const categoryCache = new Map<number, Map<string, number>>();

export async function curseForgeCategoryId(projectType: CatalogSearchQuery['projectType'], category: string): Promise<number | undefined> {
  if (/^\d+$/.test(category)) return Number(category);
  const classId = CLASS_ID[projectType];
  let bySlug = categoryCache.get(classId);
  if (!bySlug) {
    const res = await api<{ data: { id: number; slug: string; classId?: number; parentCategoryId?: number }[] }>(
      `/categories?gameId=${GAME_ID}&classId=${classId}`
    );
    bySlug = new Map(res.data.map((c) => [c.slug, c.id]));
    categoryCache.set(classId, bySlug);
  }
  for (const slug of [category, ...(CF_CATEGORY_SLUGS[category] ?? [])]) {
    const id = bySlug.get(slug);
    if (id) return id;
  }
  return undefined;
}

/** Названия проектов пачкой — для списка зависимостей. */
export async function getCurseForgeMods(ids: string[]): Promise<CatalogProject[]> {
  if (!ids.length) return [];
  const json = await post<{ data: CfMod[] }>('/mods', { modIds: ids.map(Number), filterPcOnly: true });
  return json.data.map((m) => normalizeMod(m, 'mod'));
}
