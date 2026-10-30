import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInstance } from './instances';
import { contentDir, scanMods } from './mods';
import { getModrinthProjectBriefs } from './modrinth';
import { sha1File } from './downloader';
import { recommendMemory, type MemoryAdvice } from '../../shared/memory-advice';

/** fetch с тайм-аутом: зависшее соединение не должно держать вход, загрузку или проверку бесконечно. */
const fetchT = (url: string, init: RequestInit = {}) => fetch(url, { signal: AbortSignal.timeout(20000), ...init });


const UA = 'Ploxel-Launcher (github.com/malqred/Ploxel)';
/** sha1 файла → проект Modrinth (null — на Modrinth нет). Живёт до перезапуска. */
const projectByHash = new Map<string, string | null>();

/** Проекты Modrinth для файлов без метаданных (добавлены вручную или из модпака). */
async function projectsByHash(hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing = hashes.filter((h) => !projectByHash.has(h));
  for (let i = 0; i < missing.length; i += 300) {
    const chunk = missing.slice(i, i + 300);
    const res = await fetchT('https://api.modrinth.com/v2/version_files', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: chunk, algorithm: 'sha1' })
    });
    if (!res.ok) break;
    const found = (await res.json()) as Record<string, { project_id: string }>;
    for (const h of chunk) projectByHash.set(h, found[h]?.project_id ?? null);
  }
  for (const h of hashes) {
    const id = projectByHash.get(h);
    if (id) out.set(h, id);
  }
  return out;
}

/** Рекомендуемая память для сборки: смотрит включённые моды, шейдеры и ресурспаки. */
export async function memoryAdviceFor(instanceId: string): Promise<MemoryAdvice | null> {
  const instance = readInstance(instanceId);
  if (!instance) return null;
  const all = scanMods(instanceId).filter((m) => m.enabled);
  const mods = all.filter((m) => m.kind === 'mod');
  const modDir = contentDir(instanceId, 'mod');

  // У каждого мода — id проекта Modrinth: из метаданных или по хэшу файла
  const projectOf = new Map<string, string>();
  const unknown: { fileName: string; sha1: string }[] = [];
  for (const m of mods) {
    if (m.source === 'modrinth' && m.projectId) projectOf.set(m.fileName, m.projectId);
    else {
      const sha1 = m.sha1 ?? (await sha1File(path.join(modDir, m.fileName)).catch(() => ''));
      if (sha1) unknown.push({ fileName: m.fileName, sha1 });
    }
  }
  // Без сети классифицируем по названиям — рекомендация всё равно будет
  try {
    const byHash = await projectsByHash(unknown.map((u) => u.sha1));
    for (const u of unknown) {
      const id = byHash.get(u.sha1);
      if (id) projectOf.set(u.fileName, id);
    }
  } catch {
    /* офлайн */
  }
  const ids = [...new Set(projectOf.values())];
  const briefs: Record<string, { slug: string; categories: string[] }> = ids.length
    ? await getModrinthProjectBriefs(ids).catch(() => ({}))
    : {};

  const sizeMb = (file: string) => {
    try {
      return fs.statSync(file).size / 1048576;
    } catch {
      return 0;
    }
  };
  const packDir = contentDir(instanceId, 'resourcepack');
  return recommendMemory({
    gameVersion: instance.gameVersion,
    loader: instance.loader.kind,
    mods: mods.map((m) => {
      const pid = projectOf.get(m.fileName);
      const brief = pid ? briefs[pid] : undefined;
      return { name: m.name, fileName: m.fileName, slug: brief?.slug, categories: brief?.categories };
    }),
    shaderPacks: all.filter((m) => m.kind === 'shader').length,
    resourcePackSizesMb: all.filter((m) => m.kind === 'resourcepack').map((m) => sizeMb(path.join(packDir, m.fileName))),
    totalGb: os.totalmem() / 1073741824
  });
}
