import { parseNbt, asCompound, asString, type NbtValue } from './nbt';

/** Моды, с которыми мир сохраняли в последний раз (Forge/NeoForge пишут их в level.dat). */
export interface WorldModList {
  loader?: 'forge' | 'neoforge';
  /** версия игры, в которой мир сохранён */
  gameVersion?: string;
  mods: { id: string; version?: string }[];
}

/** Не моды, а сама игра и загрузчик. */
const BUILTIN = new Set(['minecraft', 'forge', 'neoforge', 'fml', 'mcp', 'forgeclient', 'minecraftforge', 'javafml', 'lowcodefml']);

/**
 * Список модов из level.dat:
 *   Forge 1.13+ — Data.fml.LoadingModList: [{ModId, ModVersion}]
 *   Forge 1.12- — FML.ModList: [{ModId, ModVersion}]
 * Ищем любой список записей с ModId — так переживаем разницу между версиями.
 * Fabric список модов в мир не пишет — тогда null.
 */
export function readWorldMods(levelDat: Buffer): WorldModList | null {
  let root: NbtValue;
  try {
    root = parseNbt(levelDat).value;
  } catch {
    return null;
  }
  const found: { id: string; version?: string }[] = [];
  const walk = (v: NbtValue, depth: number) => {
    if (depth > 6 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, NbtValue>).ModId === 'string') {
          const rec = item as Record<string, NbtValue>;
          found.push({ id: asString(rec.ModId), version: asString(rec.ModVersion) || undefined });
        } else walk(item as NbtValue, depth + 1);
      }
      return;
    }
    for (const [key, child] of Object.entries(v)) {
      // Реестры блоков и предметов огромные и списка модов не содержат
      if (key === 'Registries' || key === 'Player' || key === 'WorldGenSettings') continue;
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  if (!found.length) return null;

  const ids = new Set(found.map((m) => m.id.toLowerCase()));
  const loader = ids.has('neoforge') ? 'neoforge' : ids.has('forge') || ids.has('fml') ? 'forge' : undefined;
  const data = asCompound(asCompound(root).Data);
  const gameVersion =
    asString(asCompound(data.Version).Name) || found.find((m) => m.id === 'minecraft')?.version || undefined;
  const seen = new Set<string>();
  const mods = found.filter((m) => {
    const id = m.id.toLowerCase();
    if (BUILTIN.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { loader, gameVersion, mods };
}
