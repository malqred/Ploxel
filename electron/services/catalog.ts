import { searchModrinth, getModrinthVersions, getModrinthProject } from './modrinth';
import { searchCurseForge, getCurseForgeFiles, getCurseForgeProject, isCurseForgeAvailable } from './curseforge';
import { catalogCategory, catalogQueries } from '../../shared/search';
import type { CatalogProject, CatalogSearchQuery, CatalogSearchResult, CatalogVersion } from '../../shared/types';

async function searchOne(q: CatalogSearchQuery): Promise<CatalogSearchResult> {
  if (q.source === 'curseforge') {
    if (!isCurseForgeAvailable()) {
      const empty: CatalogSearchResult = { hits: [], total: 0, offset: q.offset, limit: q.limit };
      return empty;
    }
    return searchCurseForge(q);
  }
  return searchModrinth(q);
}

/**
 * Поиск в каталоге с пониманием запроса: русские слова и транслит
 * переводятся в английские термины («оптимизация» → optimization,
 * «натрий» → sodium), текст в чужой раскладке исправляется. На первой
 * странице, если основной вариант дал мало результатов, добираем из
 * остальных вариантов.
 */
export async function searchCatalog(q: CatalogSearchQuery): Promise<CatalogSearchResult> {
  const variants = q.query.trim() ? catalogQueries(q.query) : [q.query];
  // Жанровый запрос («оптимизация», «моды на магию») — ищем по категории
  // Modrinth и популярности: так находятся Sodium и Lithium, а не случайные
  // моды со словом в названии
  const category = q.source === 'modrinth' && !q.category && q.query.trim() ? catalogCategory(q.query) : null;
  if (category) {
    return searchOne({ ...q, query: '', category, sort: q.sort === 'relevance' ? 'downloads' : q.sort });
  }
  const primary = await searchOne({ ...q, query: variants[0] });
  if (q.offset > 0 || primary.hits.length >= Math.min(3, q.limit) || variants.length < 2) return primary;
  const seen = new Set(primary.hits.map((h) => h.id));
  const hits = [...primary.hits];
  let total = primary.total;
  for (const alt of variants.slice(1)) {
    const res = await searchOne({ ...q, query: alt }).catch(() => null);
    if (!res) continue;
    total = Math.max(total, res.total);
    for (const h of res.hits) {
      if (!seen.has(h.id) && hits.length < q.limit) {
        seen.add(h.id);
        hits.push(h);
      }
    }
    if (hits.length >= q.limit) break;
  }
  return { ...primary, hits, total: Math.max(total, hits.length) };
}

export async function catalogVersions(
  source: 'modrinth' | 'curseforge',
  projectId: string,
  gameVersion?: string,
  loader?: string
): Promise<CatalogVersion[]> {
  if (source === 'curseforge') return getCurseForgeFiles(projectId, gameVersion, loader);
  return getModrinthVersions(projectId, gameVersion, loader);
}

export async function catalogProject(source: 'modrinth' | 'curseforge', id: string): Promise<CatalogProject | null> {
  if (source === 'curseforge') return getCurseForgeProject(id);
  return getModrinthProject(id);
}

export { isCurseForgeAvailable };