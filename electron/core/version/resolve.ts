import type { ArgumentEntry, Library, Rule, RuleContext, VersionJson } from './types';

/* ------------------------------ Правила ------------------------------ */

function ruleMatches(rule: Rule, ctx: RuleContext): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== ctx.os) return false;
    if (rule.os.arch && rule.os.arch !== ctx.arch) return false;
    if (rule.os.version && ctx.osVersion) {
      try {
        if (!new RegExp(rule.os.version).test(ctx.osVersion)) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if (Boolean(ctx.features[key]) !== expected) return false;
    }
  }
  return true;
}

/** Правила Mojang: если правил нет — элемент разрешён; иначе решает последнее совпавшее. */
export function isAllowed(rules: Rule[] | undefined, ctx: RuleContext): boolean {
  if (!rules || rules.length === 0) return true;
  let result = false;
  for (const rule of rules) {
    if (ruleMatches(rule, ctx)) result = rule.action === 'allow';
  }
  return result;
}

/* ------------------------------ Аргументы ------------------------------ */

export function expandArguments(
  entries: (string | ArgumentEntry)[] | undefined,
  ctx: RuleContext,
  vars: Record<string, string>
): string[] {
  if (!entries) return [];
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(applyVars(entry, vars));
      continue;
    }
    if (!entry || !isAllowed(entry.rules, ctx)) continue;
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    for (const v of values) out.push(applyVars(v, vars));
  }
  return out;
}

/** Старый формат minecraftArguments (до 1.13) — строка через пробел. */
export function splitLegacyArguments(line: string, vars: Record<string, string>): string[] {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => applyVars(part, vars));
}

export function applyVars(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (whole, name: string) => {
    const key = name.toLowerCase();
    return vars[key] !== undefined ? vars[key] : whole;
  });
}

/* ------------------------------ Библиотеки ------------------------------ */

export function mavenPath(name: string): string {
  // group:artifact:version[:classifier][@ext]
  const [coords, ext = 'jar'] = name.split('@');
  const parts = coords.split(':');
  const [group, artifact, version, classifier] = parts;
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

export function libraryPath(lib: Library, classifier?: string): string | null {
  if (classifier && lib.downloads?.classifiers?.[classifier]?.path) {
    return lib.downloads.classifiers[classifier].path!;
  }
  if (lib.downloads?.artifact?.path) return lib.downloads.artifact.path;
  if (classifier) return mavenPath(`${lib.name}:${classifier}`);
  return mavenPath(lib.name);
}

export function libraryUrl(lib: Library, path: string): string | null {
  const artifact = lib.downloads?.artifact;
  if (artifact?.url && artifact.path === path) return artifact.url;
  if (lib.url) return lib.url.replace(/\/$/, '') + '/' + path;
  return null;
}

export interface ResolvedLibrary {
  name: string;
  path: string;
  url: string | null;
  sha1?: string;
  size?: number;
  isNative: boolean;
  extractExclude?: string[];
}

export interface ResolveLibrariesResult {
  classpath: ResolvedLibrary[];
  natives: ResolvedLibrary[];
}

/** Отбирает библиотеки под текущую ОС, разворачивает классификаторы нативов. */
export function resolveLibraries(libraries: Library[], ctx: RuleContext): ResolveLibrariesResult {
  const seen = new Map<string, ResolvedLibrary>();
  const natives: ResolvedLibrary[] = [];
  const osName = ctx.os;

  for (const lib of libraries) {
    if (!isAllowed(lib.rules, ctx)) continue;

    const classifierTemplate = lib.natives?.[osName];
    if (classifierTemplate) {
      const classifier = classifierTemplate.replace('${arch}', ctx.arch === 'x86' ? '32' : '64');
      const download = lib.downloads?.classifiers?.[classifier];
      const path = download?.path ?? mavenPath(`${lib.name}:${classifier}`);
      natives.push({
        name: `${lib.name}:${classifier}`,
        path,
        url: download?.url ?? null,
        sha1: download?.sha1,
        size: download?.size,
        isNative: true,
        extractExclude: lib.extract?.exclude
      });
      continue;
    }

    const artifact = lib.downloads?.artifact;
    if (!artifact && !lib.downloads?.classifiers) {
      // Библиотеки без downloads (старый Forge) — собираем путь из maven-координат.
      const path = mavenPath(lib.name);
      seen.set(dedupeKey(lib.name), {
        name: lib.name,
        path,
        url: lib.url ? `${lib.url.replace(/\/$/, '')}/${path}` : null,
        isNative: false
      });
      continue;
    }
    if (!artifact) continue; // только нативы, не для classpath

    const path = artifact.path ?? mavenPath(lib.name);
    seen.set(dedupeKey(lib.name), {
      name: lib.name,
      path,
      url: artifact.url ?? null,
      sha1: artifact.sha1,
      size: artifact.size,
      isNative: false
    });
  }

  return { classpath: [...seen.values()], natives };
}

function dedupeKey(name: string): string {
  // group:artifact + классификатор. Версию НЕ учитываем: загрузчик должен
  // переопределять версию библиотеки из ванильной версии (например, ASM).
  // Классификатор важен, иначе натив-джар вытеснит основной jar из classpath.
  const [coords] = name.split('@');
  const parts = coords.split(':');
  const [group, artifact, , classifier] = parts;
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`.toLowerCase();
}

/* ------------------------------ inheritsFrom ------------------------------ */

/** Сливает версию загрузчика (дочернюю) с ванильной (родительской). */
export function mergeVersions(parent: VersionJson, child: VersionJson): VersionJson {
  const merged: VersionJson = {
    ...parent,
    ...child,
    id: child.id,
    mainClass: child.mainClass ?? parent.mainClass,
    libraries: [...(parent.libraries ?? []), ...(child.libraries ?? [])],
    arguments: child.arguments
      ? {
          game: [...(parent.arguments?.game ?? []), ...(child.arguments.game ?? [])],
          jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments.jvm ?? [])]
        }
      : parent.arguments,
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    downloads: child.downloads?.client ? child.downloads : parent.downloads,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    logging: child.logging ?? parent.logging
  };
  return merged;
}