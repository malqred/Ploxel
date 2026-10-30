/**
 * Один и тот же мод в Modrinth и CurseForge — разные проекты с разными id.
 * Узнаём его по названию: «Lithium (Fabric/NeoForge)» и «Lithium»,
 * «Just Enough Items (JEI)» и «Just Enough Items» — одно и то же.
 */

// Пометка о загрузчике в конце названия: «Sodium for Fabric», «Waystones - Forge», «X Fabric/NeoForge».
// В начале названия слово остаётся: «Fabric API» — это имя мода.
const TRAILING_LOADER = /[\s\-–—:|]*(?:for\s+)?(?:fabric|forge|neoforge|quilt)(?:\s*[/&,+]\s*(?:fabric|forge|neoforge|quilt))*\s*$/;

/** Название проекта без пометок о загрузчике, скобок и знаков. */
export function projectKey(title: string): string {
  let t = title.toLowerCase().replace(/[([{][^)\]}]*[)\]}]/g, ' ').trim();
  const stripped = t.replace(TRAILING_LOADER, '').trim();
  if (stripped.length > 2) t = stripped;
  return t.replace(/[^\p{L}\p{N}]/gu, '');
}

export interface NamedMod {
  name: string;
  projectId?: string;
  source?: string;
}

/**
 * Установленный мод, который совпадает с проектом из другого каталога
 * (по названию или slug). Свой же проект (тот же id) сюда не попадает —
 * его находят по projectId.
 */
export function findTwin<T extends NamedMod>(
  project: { title: string; slug?: string; id?: string; source?: string },
  installed: T[]
): T | undefined {
  const keys = new Set([projectKey(project.title), project.slug ? projectKey(project.slug) : ''].filter((k) => k.length > 2));
  if (!keys.size) return undefined;
  return installed.find(
    (m) => !(m.projectId && m.projectId === project.id && m.source === project.source) && keys.has(projectKey(m.name))
  );
}
