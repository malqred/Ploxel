// Чтение метаданных модов из jar/zip-файлов.
//
// Поддерживаемые форматы (по приоритету):
//   fabric.mod.json, quilt.mod.json,
//   META-INF/neoforge.mods.toml, META-INF/mods.toml, mcmod.info.
//
// Функция не бросает исключений: на битых архивах возвращает частичные
// данные и текст ошибки в поле `error`.

import AdmZip from 'adm-zip';
import type { JarMetadata } from '../../shared/types';

/** JarMetadata + служебные поля (error, optional, loaderVersion). */
export interface JarReadResult extends JarMetadata {
  /** Текст ошибки, если файл битый/не читается (данные частичные). */
  error?: string;
  /** Необязательные зависимости (mandatory=false / optional): id → диапазоны. */
  optional: Record<string, string[]>;
  /** Требование к версии загрузчика (loaderVersion из mods.toml и т.п.). */
  loaderVersion?: string;
  /** mod-id вложенных jar (jar-in-jar): закрывают зависимости, но не конфликтуют —
   *  при совпадении загрузчик сам берёт более новую копию */
  bundled?: string[];
}

function emptyResult(file: string): JarReadResult {
  return { file, provides: [], depends: {}, breaks: {}, optional: {}, loaders: [] };
}

export function readJarMetadata(file: string): JarReadResult {
  const result = emptyResult(file);
  let zip: AdmZip;
  try {
    zip = new AdmZip(file);
  } catch (e) {
    result.error = e instanceof Error ? e.message : 'Не удалось открыть файл';
    return result;
  }

  // Имена записей сравниваем без учёта регистра.
  const entries = new Map<string, AdmZip.IZipEntry>();
  for (const entry of zip.getEntries()) entries.set(entry.entryName.toLowerCase(), entry);

  const readText = (name: string): string | null => {
    const entry = entries.get(name.toLowerCase());
    if (!entry || entry.isDirectory) return null;
    try {
      return entry.getData().toString('utf8');
    } catch {
      return null;
    }
  };

  // Загрузчик — по наличию файлов метаданных.
  if (entries.has('fabric.mod.json')) result.loaders.push('fabric');
  if (entries.has('quilt.mod.json')) result.loaders.push('quilt');
  if (entries.has('meta-inf/neoforge.mods.toml')) result.loaders.push('neoforge');
  if (entries.has('meta-inf/mods.toml')) result.loaders.push('forge');
  if (entries.has('mcmod.info')) result.loaders.push('forge');

  // Вложенные jar (Fabric API, Quilt Standard Libraries, Forge JarJar): их
  // mod-id тоже «предоставляются» этим файлом — иначе зависимости вроде
  // fabric-renderer-api-v1 считались бы отсутствующими.
  for (const [name, entry] of entries) {
    if (!/^meta-inf\/(jars|jarjar)\/[^/]+\.jar$/.test(name) || entry.isDirectory) continue;
    try {
      const inner = new AdmZip(entry.getData());
      for (const metaName of ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
        const e = inner.getEntry(metaName);
        if (!e) continue;
        const text = e.getData().toString('utf8');
        const ids = metaName.endsWith('.json')
          ? (() => {
              const j = JSON.parse(text) as { id?: string; quilt_loader?: { id?: string }; provides?: unknown };
              const list = [j.id ?? j.quilt_loader?.id];
              if (Array.isArray(j.provides)) list.push(...j.provides.filter((x): x is string => typeof x === 'string'));
              return list;
            })()
          : [...text.matchAll(/modId\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
        result.bundled ??= [];
        for (const id of ids) if (id && !result.bundled.includes(id)) result.bundled.push(id);
        break;
      }
    } catch {
      /* битый вложенный jar — пропускаем */
    }
  }

  // Порядок важен: специфичные форматы раньше общих.
  for (const source of ['fabric.mod.json', 'quilt.mod.json', 'meta-inf/neoforge.mods.toml', 'meta-inf/mods.toml', 'mcmod.info']) {
    const raw = readText(source);
    if (raw == null) continue;
    try {
      applyMetadata(result, source, raw);
    } catch (e) {
      if (!result.error) result.error = `Не удалось прочитать ${source}: ${e instanceof Error ? e.message : 'ошибка разбора'}`;
    }
  }
  return result;
}

function applyMetadata(result: JarReadResult, source: string, raw: string): void {
  if (source === 'fabric.mod.json' || source === 'quilt.mod.json') {
    applyFabricLike(result, raw);
    return;
  }
  if (source.endsWith('.toml')) {
    applyModsToml(result, raw);
    return;
  }
  applyMcModInfo(result, raw);
}

/** fabric.mod.json / quilt.mod.json — один и тот же JSON-формат. */
function applyFabricLike(result: JarReadResult, raw: string): void {
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (typeof data.id === 'string') result.id ??= data.id;
  if (typeof data.name === 'string') result.name ??= data.name;
  if (typeof data.version === 'string') result.version ??= data.version;
  result.depends = { ...rangesToMap(data.depends), ...result.depends };
  result.breaks = { ...rangesToMap(data.breaks), ...result.breaks };
  result.optional = { ...rangesToMap(data.recommends ?? data.suggests), ...result.optional };
  const provides = data.provides;
  if (Array.isArray(provides)) {
    for (const p of provides) if (typeof p === 'string' && !result.provides.includes(p)) result.provides.push(p);
  } else if (provides && typeof provides === 'object') {
    for (const p of Object.keys(provides as Record<string, unknown>)) {
      if (!result.provides.includes(p)) result.provides.push(p);
    }
  }
  if (result.loaders.includes('fabric') && typeof data.fabric_loader === 'string') result.loaderVersion ??= data.fabric_loader;
  if (result.loaders.includes('quilt') && typeof data.quilt_loader === 'string') result.loaderVersion ??= data.quilt_loader;
}

/** Значение в fabric.mod.json: строка-диапазон или массив диапазонов. */
function rangesToMap(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, range] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(range)) {
      out[key] = range.filter((r): r is string => typeof r === 'string');
    } else if (typeof range === 'string') {
      out[key] = [range];
    }
  }
  return out;
}

/**
 * Минимальный разбор mods.toml / neoforge.mods.toml.
 * Берём только то, что нужно: [[mods]] (modId, version, displayName),
 * [[dependencies.<id>]] (modId, mandatory, versionRange) и loaderVersion.
 */
function applyModsToml(result: JarReadResult, raw: string): void {
  interface TomlMod { modId?: string; version?: string; displayName?: string }
  interface TomlDep { modId: string; mandatory: boolean; versionRange?: string }
  const mods: TomlMod[] = [];
  const deps: TomlDep[] = [];
  let curMod: TomlMod | null = null;
  let curDep: TomlDep | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === '[[mods]]') {
      curMod = {};
      mods.push(curMod);
      curDep = null;
      continue;
    }
    const depHeader = trimmed.match(/^\[\[dependencies\.([^,\]]+)\]\]$/);
    if (depHeader) {
      curDep = { modId: unquote(depHeader[1]), mandatory: true };
      deps.push(curDep);
      curMod = null;
      continue;
    }
    if (trimmed.startsWith('[')) {
      curMod = null;
      curDep = null;
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = unquote(trimmed.slice(0, eq).trim());
    const value = unquote(trimmed.slice(eq + 1).trim());

    if (curDep) {
      if (key === 'modId') curDep.modId = value;
      else if (key === 'mandatory') curDep.mandatory = value === 'true';
      else if (key === 'versionRange' || key === 'range') curDep.versionRange = value;
    } else if (curMod) {
      if (key === 'modId') curMod.modId = value;
      else if (key === 'version') curMod.version = value;
      else if (key === 'displayName') curMod.displayName = value;
    } else if (key === 'loaderVersion') {
      result.loaderVersion ??= value;
    }
  }

  const mod = mods.find((m) => m.modId) ?? mods[0];
  if (mod?.modId) result.id ??= mod.modId;
  if (mod?.displayName) result.name ??= mod.displayName;
  if (mod?.version) result.version ??= mod.version;

  for (const dep of deps) {
    if (!dep.modId) continue;
    const ranges = dep.versionRange && dep.versionRange !== '*' ? [dep.versionRange] : ['*'];
    if (dep.mandatory) {
      result.depends[dep.modId] = [...new Set([...(result.depends[dep.modId] ?? []), ...ranges])];
    } else {
      result.optional[dep.modId] = [...new Set([...(result.optional[dep.modId] ?? []), ...ranges])];
    }
  }
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/** mcmod.info — JSON (массив или один объект) в корне jar. */
function applyMcModInfo(result: JarReadResult, raw: string): void {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('битый JSON');
  }
  const list = Array.isArray(data) ? data : [data];
  const info = (list.find((x): x is Record<string, unknown> => !!x && typeof x === 'object') ?? {}) as Record<string, unknown>;

  if (typeof info.modid === 'string') result.id ??= info.modid;
  if (typeof info.name === 'string') result.name ??= info.name;
  if (typeof info.version === 'string') result.version ??= info.version;

  // requiredMods: массив объектов {modid, versionRange?} или строка "a,b".
  const required = info.requiredMods ?? info.dependencies;
  if (typeof required === 'string') {
    for (const part of required.split(',')) {
      const p = part.trim();
      if (p && !result.depends[p]) result.depends[p] = ['*'];
    }
  } else if (Array.isArray(required)) {
    for (const r of required) {
      if (!r || typeof r !== 'object') continue;
      const obj = r as Record<string, unknown>;
      if (typeof obj.modid !== 'string') continue;
      const range = typeof obj.versionRange === 'string' && obj.versionRange !== '*' ? [obj.versionRange] : ['*'];
      if (!result.depends[obj.modid]) result.depends[obj.modid] = range;
    }
  }
}

/**
 * Совпадает ли версия с диапазоном. Поддерживаются форматы Fabric/Quilt и
 * Forge: "*", ">=1.20", ">=1.21.9- <1.21.10-" (через пробел — «и»),
 * "~1.21.10", "^0.16", "1.21.x", "1.20 || 1.21", Maven "[1.20,1.21)".
 */
export function satisfiesRange(version: string, range: string): boolean {
  const text = (range ?? '').trim();
  if (!text || text === '*' || text === '+') return true;
  for (const part of text.split('||')) {
    const p = part.trim();
    if (!p) continue;
    // Maven-диапазон целиком; иначе — набор условий через пробел (все должны выполниться)
    if (/^[\[(]/.test(p)) {
      if (matchRangePart(version, p)) return true;
      continue;
    }
    const comparators = p.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1').split(/\s+/).filter(Boolean);
    if (comparators.every((c) => matchRangePart(version, c))) return true;
  }
  return false;
}

function matchRangePart(version: string, part: string): boolean {
  if (!part || part === '*' || part === '+') return true;

  // Maven-диапазон: [1.20,1.21), [1.20,), (,1.21], [1.20]
  const maven = part.match(/^([\[(])([^,]*)\s*,\s*([^)\]]*)([\])])$/);
  if (maven) {
    const [, loBrace, lo, hi, hiBrace] = maven;
    if (lo) {
      const c = compareSemver(version, lo.trim());
      if (c < 0 || (c === 0 && loBrace === '(')) return false;
    }
    if (hi) {
      const c = compareSemver(version, hi.trim());
      if (c > 0 || (c === 0 && hiBrace === ')')) return false;
    }
    return true;
  }
  const exact = part.match(/^\[([^\],]+)\]$/);
  if (exact) return compareSemver(version, exact[1].trim()) === 0;

  // ~1.21.10 → >=1.21.10 <1.22; ^0.16 → >=0.16 <0.17 (для 0.x) или <след. мажорной
  const tilde = part.match(/^~\s*([\w.+-]+)$/);
  if (tilde) {
    const base = numbers(tilde[1]);
    const upper = base.length > 1 ? [base[0], base[1] + 1] : [base[0] + 1];
    return compareSemver(version, tilde[1]) >= 0 && compareNums(numbers(version), upper) < 0;
  }
  const caret = part.match(/^\^\s*([\w.+-]+)$/);
  if (caret) {
    const base = numbers(caret[1]);
    const idx = base.findIndex((n) => n !== 0);
    const pos = idx < 0 ? base.length - 1 : idx;
    const upper = base.slice(0, pos + 1);
    upper[pos] += 1;
    return compareSemver(version, caret[1]) >= 0 && compareNums(numbers(version), upper) < 0;
  }
  // 1.21.x / 1.21.* / 1.21 без оператора в форме шаблона
  const wildcard = part.match(/^=?\s*(\d+(?:\.\d+)*)\.[x*X]$/);
  if (wildcard) {
    const prefix = numbers(wildcard[1]);
    const v = numbers(version);
    return prefix.every((n, i) => v[i] === n);
  }

  const single = part.match(/^(>=|<=|>|<|==|=)?\s*([\w.+-]+)$/);
  if (single) {
    const c = compareSemver(version, single[2]);
    switch (single[1]) {
      case '>=':
        return c >= 0;
      case '<=':
        return c <= 0;
      case '>':
        return c > 0;
      case '<':
        return c < 0;
      default:
        return c === 0;
    }
  }
  return false;
}

function numbers(v: string): number[] {
  const core = v.split('+')[0].split('-')[0];
  return core.split('.').map((x) => Number.parseInt(x, 10) || 0);
}

function compareNums(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Сравнение по semver: числовое ядро, затем пре-релиз меньше релиза.
 * "1.21.9-" (пустой пре-релиз) — самая ранняя сборка 1.21.9, меньше "1.21.9".
 * Метаданные после "+" не учитываются.
 */
export function compareSemver(a: string, b: string): number {
  const c = compareNums(numbers(a), numbers(b));
  if (c) return c;
  const preA = a.split('+')[0].includes('-') ? a.split('+')[0].slice(a.split('+')[0].indexOf('-') + 1) : null;
  const preB = b.split('+')[0].includes('-') ? b.split('+')[0].slice(b.split('+')[0].indexOf('-') + 1) : null;
  if (preA === null && preB === null) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  return preA.localeCompare(preB, 'en', { numeric: true });
}
