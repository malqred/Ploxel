// Импорт сборок из других лаунчеров: детект (только чтение), перенос (copy/link),
// архивы-модпаки и опознание модов по хэшу.
// Детект ничего не записывает. При импорте оригиналы не изменяются и не удаляются.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { compareVersions } from '../core/version-compare';
import { instanceDir } from './paths';
import { createInstance, listInstances, setInstanceCover, updateInstance } from './instances';
import { persistMods, scanMods } from './mods';
import { sha1File } from './downloader';
import { installModpackArchive } from './modpack';
import { getModrinthVersionByHash } from './modrinth';
import type {
  CatalogVersion,
  ImportedInstanceInfo,
  ImportOptions,
  ImportResult,
  Instance,
  LauncherDetection,
  LoaderKind,
  LoaderSpec
} from '../../shared/types';

const MODRINTH_BASE = 'https://api.modrinth.com/v2';

/* ------------------------------ Безопасность файлов ------------------------------ */

// Файлы, которые никогда не импортируются: аккаунты, токены, служебные файлы.
const DENY_FILE = /^(launcher_accounts|accounts|token|auth[-_]?token|session)[^/]*\.(json|dat|key|txt)$/i;

function isDeniedFile(name: string): boolean {
  return name === '.lock' || name.endsWith('.lock') || DENY_FILE.test(name);
}

// Папки, которые не переносим (общие данные игры лаунчер докачает сам).
const SKIP_DIRS = new Set([
  'versions',
  'libraries',
  'library',
  'assets',
  'natives',
  'cache',
  'logs',
  'crash-reports',
  '.git'
]);

// Пользовательские данные, по которым считаем размер .minecraft-папки.
const USER_DATA_DIRS = ['mods', 'saves', 'config', 'resourcepacks', 'shaderpacks', 'screenshots'];

// Каталоги, которые всегда переносим при импорте.
const ALWAYS_DIRS = ['mods', 'resourcepacks', 'shaderpacks', 'config'];

interface CopyState {
  mode: 'copy' | 'link';
  warnings: string[];
  linkWarning: boolean;
}

/* ------------------------------ Где искать лаунчеры ------------------------------ */

interface EnvRoots {
  appdata: string;
  local: string;
  home: string;
  documents: string;
  programFiles: string[];
}

function readEnvRoots(): EnvRoots {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return {
    appdata: process.env.APPDATA || '',
    local: process.env.LOCALAPPDATA || '',
    home,
    documents: home ? path.join(home, 'Documents') : '',
    programFiles: [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(
      (v): v is string => Boolean(v)
    )
  };
}

interface LauncherDef {
  id: string;
  name: string;
  kind: 'minecraft' | 'profile';
  /** Корни, в которых лежат сборки (для kind = profile — папка с подпапкой instances). */
  roots: (env: EnvRoots) => string[];
  /** Подпапка со сборками внутри корней (для kind = profile). */
  sub?: string;
  /** Маркерные файлы сборки (для kind = profile). */
  markers: string[];
}

/** Папки с данными приложений из Microsoft Store (MSIX): AppData у них перенаправлен. */
function packageRoots(env: EnvRoots, prefix: string, sub: string): string[] {
  const packages = path.join(env.local, 'Packages');
  try {
    return fs
      .readdirSync(packages)
      .filter((n) => n.toLowerCase().startsWith(prefix))
      .map((n) => path.join(packages, n, 'LocalCache', 'Roaming', sub));
  } catch {
    return [];
  }
}

/** Путь из текстового файла-указателя (XMCL хранит корень данных в файле root). */
function pointerFile(file: string): string | null {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return value && path.isAbsolute(value) ? value : null;
  } catch {
    return null;
  }
}

const LAUNCHERS: LauncherDef[] = [
  {
    id: 'minecraft',
    name: 'Официальный лаунчер',
    kind: 'minecraft',
    markers: [],
    roots: (e) => [path.join(e.appdata, '.minecraft'), path.join(e.documents, '.minecraft')]
  },
  {
    id: 'prism',
    name: 'Prism Launcher',
    kind: 'profile',
    sub: 'instances',
    markers: ['instance.cfg', 'mmc-pack.json'],
    roots: (e) => [
      path.join(e.appdata, 'PrismLauncher'),
      path.join(e.local, 'PrismLauncher'),
      ...e.programFiles.map((pf) => path.join(pf, 'PrismLauncher')),
      ...packageRoots(e, 'prismlauncher', 'PrismLauncher')
    ]
  },
  {
    id: 'polymc',
    name: 'PolyMC',
    kind: 'profile',
    sub: 'instances',
    markers: ['instance.cfg', 'mmc-pack.json'],
    roots: (e) => [path.join(e.appdata, 'PolyMC'), path.join(e.local, 'PolyMC')]
  },
  {
    id: 'multimc',
    name: 'MultiMC',
    kind: 'profile',
    sub: 'instances',
    markers: ['instance.cfg'],
    roots: (e) => [path.join(e.appdata, 'MultiMC'), path.join(e.local, 'MultiMC'), path.join(e.home, 'MultiMC')]
  },
  {
    id: 'atlauncher',
    name: 'ATLauncher',
    kind: 'profile',
    sub: 'Instances',
    markers: ['instance.json'],
    roots: (e) => [path.join(e.appdata, 'ATLauncher'), path.join(e.local, 'ATLauncher'), path.join(e.home, 'ATLauncher')]
  },
  {
    id: 'gdlauncher',
    name: 'GDLauncher',
    kind: 'profile',
    sub: 'instances',
    markers: ['instance.json', 'config.json'],
    roots: (e) => [
      path.join(e.appdata, 'gdlauncher_next'),
      path.join(e.local, 'gdlauncher_next'),
      path.join(e.appdata, 'gdlauncher_carbon', 'data'),
      path.join(e.local, 'gdlauncher_carbon', 'data')
    ]
  },
  {
    id: 'curseforge',
    name: 'CurseForge',
    kind: 'profile',
    sub: 'Instances',
    markers: ['minecraftinstance.json'],
    roots: (e) => [path.join(e.home, 'curseforge', 'minecraft'), path.join(e.appdata, 'curseforge', 'minecraft')]
  },
  {
    id: 'modrinth',
    name: 'Modrinth App',
    kind: 'profile',
    sub: 'profiles',
    // Новый Modrinth App хранит описание сборок в app.db, а не в profile.json
    markers: ['profile.json', 'mods', 'saves', 'options.txt'],
    roots: (e) => [path.join(e.appdata, 'ModrinthApp'), path.join(e.appdata, 'com.modrinth.theseus')]
  },
  {
    id: 'xmcl',
    name: 'X Minecraft Launcher',
    kind: 'profile',
    sub: 'instances',
    markers: ['instance.json'],
    roots: (e) => {
      const configs = [path.join(e.appdata, 'xmcl'), ...packageRoots(e, 'xmcl', 'xmcl')];
      const out = [path.join(e.appdata, '.minecraftx'), ...configs];
      for (const c of configs) {
        const root = pointerFile(path.join(c, 'root'));
        if (root) out.unshift(root);
      }
      return out;
    }
  },
  {
    id: '16launcher',
    name: '16Launcher',
    kind: 'profile',
    sub: 'instances',
    markers: ['config.json'],
    roots: (e) => {
      const base = path.join(e.appdata, '16Launcher');
      const settings = safeJson<{ game_directory?: unknown }>(path.join(base, 'settings.json'));
      const custom = str(settings?.game_directory);
      return [...(custom ? [custom] : []), path.join(base, 'game')];
    }
  },
  {
    id: 'ftb',
    name: 'FTB App',
    kind: 'profile',
    sub: 'instances',
    markers: ['instance.json'],
    roots: (e) => [path.join(e.local, '.ftba'), path.join(e.home, '.ftba'), path.join(e.appdata, '.ftba')]
  },
  {
    id: 'technic',
    name: 'Technic Launcher',
    kind: 'profile',
    sub: 'modpacks',
    markers: ['bin', 'mods'],
    roots: (e) => [path.join(e.appdata, '.technic')]
  }
];

const BY_ID: Record<string, LauncherDef> = {};
for (const def of LAUNCHERS) BY_ID[def.id] = def;

// TLauncher/SKLauncher используют тот же .minecraft; выносим отдельным источником,
// если в папке найдены артефакты TLauncher/SKLauncher.
const TL_DEF: LauncherDef = {
  id: 'tl-sk',
  name: 'TLauncher / SKLauncher',
  kind: 'minecraft',
  markers: [],
  roots: () => []
};

function hasTlMarker(mcRoot: string): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(mcRoot);
  } catch {
    return false;
  }
  return names.some((n) => /(tlauncher|sklauncher)/i.test(n) || n === 'launcher_profiles.xml');
}

/* ------------------------------ Разбор конфигов ------------------------------ */

function safeJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function parseCfg(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (key && !(key in out)) out[key] = line.slice(i + 1).trim();
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function asLoaderKind(v: unknown): LoaderKind | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase();
  if (s.includes('neoforge') || s === 'neo') return 'neoforge';
  if (s.includes('forge')) return 'forge';
  if (s.includes('fabric')) return 'fabric';
  if (s.includes('quilt')) return 'quilt';
  if (s === 'vanilla' || s === '') return 'vanilla';
  return null;
}

interface MmcComponent {
  uid?: string;
  version?: unknown;
}

function mmcVersionString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return str((v as { version?: unknown }).version);
  return undefined;
}

/** Версия игры и загрузчик из mmc-pack.json (Prism/MultiMC). */
function readMmcPack(file: string): { gameVersion?: string; loader: LoaderSpec } {
  const pack = safeJson<{ components?: MmcComponent[] }>(file);
  let gameVersion: string | undefined;
  let loader: LoaderSpec = { kind: 'vanilla' };
  for (const c of pack?.components ?? []) {
    const uid = c.uid ?? '';
    const ver = mmcVersionString(c.version);
    if (uid === 'net.minecraft.minecraft' || uid === 'net.minecraft') {
      gameVersion ??= ver;
      continue;
    }
    let kind: LoaderKind | null = null;
    if (uid.includes('neoforge')) kind = 'neoforge';
    else if (uid.includes('forge') || uid.includes('minecraftforge')) kind = 'forge';
    else if (uid.includes('fabric')) kind = 'fabric';
    else if (uid.includes('quilt')) kind = 'quilt';
    if (kind && loader.kind === 'vanilla') loader = { kind, version: ver };
  }
  return { gameVersion, loader };
}

/** Загрузчик из JSON-конфига ATLauncher/GDLauncher/XMCL (поля различаются). */
function loaderFromJson(j: Record<string, unknown>): LoaderSpec {
  const explicit: [string, LoaderKind][] = [
    ['neoforge_version', 'neoforge'],
    ['forge_version', 'forge'],
    ['fabric_version', 'fabric'],
    ['quilt_version', 'quilt']
  ];
  for (const [key, kind] of explicit) {
    const v = str(j[key]);
    if (v) return { kind, version: v };
  }
  const ld = j.loader;
  if (typeof ld === 'string') {
    const kind = asLoaderKind(ld);
    if (kind && kind !== 'vanilla') return { kind };
  }
  if (ld && typeof ld === 'object') {
    const o = ld as Record<string, unknown>;
    const kind = asLoaderKind(o.type ?? o.kind);
    if (kind && kind !== 'vanilla') return { kind, version: str(o.version) };
  }
  // instance_version вида "1.20.1-forge-47.2.0"
  const iv = str(j.instance_version);
  if (iv) {
    const lower = iv.toLowerCase();
    for (const kind of ['neoforge', 'forge', 'fabric', 'quilt'] as const) {
      if (lower.includes(kind)) {
        const m = iv.match(new RegExp(`-${kind}[- ]?(.+)$`, 'i'));
        return { kind, version: m?.[1] };
      }
    }
  }
  return { kind: 'vanilla' };
}

function gameVersionOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o.minecraft) ?? str(o.version) ?? str(o.gameVersion);
  }
  return undefined;
}

function firstVersionSegment(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = v.match(/^(\d+(?:\.\d+)*)/);
  return m ? m[1] : undefined;
}

/* ------------------------------ Счётчики и размеры ------------------------------ */

function countJars(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')).length;
  } catch {
    return 0;
  }
}

function countDirs(dir: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

function dirSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(full);
    else if (e.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        /* файл мог исчезнуть — пропускаем */
      }
    }
  }
  return total;
}

/** Версия игры по папке versions/ (тот id, для которого есть <id>.json). */
function versionFromVersionsDir(mcRoot: string): string | undefined {
  const versions = path.join(mcRoot, 'versions');
  let entries: string[];
  try {
    entries = fs.readdirSync(versions);
  } catch {
    return undefined;
  }
  const candidates = entries.filter((id) => fs.existsSync(path.join(versions, id, `${id}.json`)));
  if (!candidates.length) return undefined;
  candidates.sort(compareVersions);
  return candidates[candidates.length - 1];
}

/* ------------------------------ Сборка описания инстанса ------------------------------ */

/**
 * Версия игры и загрузчик по логу последнего запуска — для папок без описания
 * (или когда в описании нет версии). Читаем только начало файла.
 */
export function inferFromLog(text: string): { gameVersion?: string; loader?: LoaderSpec } {
  const fabric = text.match(/Loading Minecraft (\S+) with (Fabric|Quilt) Loader (\S+)/);
  if (fabric) return { gameVersion: fabric[1], loader: { kind: fabric[2] === 'Quilt' ? 'quilt' : 'fabric', version: fabric[3] } };
  const mc = text.match(/--fml\.mcVersion,\s*([^,\]\s]+)/);
  if (mc) {
    const neo = text.match(/--fml\.neoForgeVersion,\s*([^,\]\s]+)/);
    if (neo) return { gameVersion: mc[1], loader: { kind: 'neoforge', version: neo[1] } };
    const forge = text.match(/--fml\.forgeVersion,\s*([^,\]\s]+)/);
    if (forge) return { gameVersion: mc[1], loader: { kind: 'forge', version: forge[1] } };
    return { gameVersion: mc[1] };
  }
  const vanilla = text.match(/Minecraft Version:\s*(\S+)/) ?? text.match(/Loading Minecraft (\S+)/);
  return vanilla ? { gameVersion: vanilla[1] } : {};
}

function readLogHead(folder: string): string {
  for (const file of [path.join(folder, 'logs', 'latest.log'), path.join(folder, 'logs', 'debug.log')]) {
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(64 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        return buf.subarray(0, n).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* лога нет — пробуем следующий */
    }
  }
  return '';
}

/**
 * Версия игры и загрузчик по id версии лаунчера: «fabric-loader-0.16.9-1.21.1»,
 * «1.20.1-forge-47.3.0», «neoforge-21.1.77», «quilt-loader-0.26.0-1.20.1».
 * Для NeoForge версию игры берём из inheritsFrom в versions/<id>/<id>.json.
 */
export function parseVersionId(id: string, mcRoot?: string): { gameVersion?: string; loader: LoaderSpec } {
  const lower = id.toLowerCase();
  const inherits = mcRoot
    ? str(safeJson<{ inheritsFrom?: unknown }>(path.join(mcRoot, 'versions', id, `${id}.json`))?.inheritsFrom)
    : undefined;
  let m = lower.match(/^(fabric|quilt)-loader-([^-]+)-(.+)$/);
  if (m) return { gameVersion: m[3], loader: { kind: m[1] as LoaderKind, version: m[2] } };
  m = lower.match(/^(.+?)-(neoforge|forge)-(.+)$/);
  if (m) return { gameVersion: m[1], loader: { kind: m[2] as LoaderKind, version: m[3] } };
  m = lower.match(/^(neoforge|forge)-(.+)$/);
  if (m) return { gameVersion: inherits, loader: { kind: m[1] as LoaderKind, version: m[2] } };
  if (inherits) {
    const kind = asLoaderKind(lower);
    return { gameVersion: inherits, loader: kind && kind !== 'vanilla' ? { kind } : { kind: 'vanilla' } };
  }
  return { gameVersion: id, loader: { kind: 'vanilla' } };
}

/* ---------------------- Modrinth App: описание сборок в app.db ---------------------- */

interface DbMeta {
  name?: string;
  gameVersion?: string;
  loader: LoaderSpec;
}

/**
 * Новый Modrinth App хранит сборки в SQLite (app.db). Открываем базу только
 * на чтение встроенным node:sqlite; если не вышло — сборки всё равно найдутся
 * по папкам, а версию подскажет лог.
 */
function readModrinthDb(root: string): Map<string, DbMeta> {
  const out = new Map<string, DbMeta>();
  const file = path.join(root, 'app.db');
  if (!fs.existsSync(file)) return out;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `select i.path as path, i.name as name, c.game_version as gv, c.loader as loader, c.loader_version as lv
           from instances i left join instance_content_sets c on c.id = i.applied_content_set_id`
        )
        .all() as { path?: string; name?: string; gv?: string; loader?: string; lv?: string }[];
      for (const r of rows) {
        if (!r.path) continue;
        const kind = asLoaderKind(r.loader ?? '');
        out.set(path.resolve(root, 'profiles', r.path).toLowerCase(), {
          name: r.name ?? undefined,
          gameVersion: r.gv ?? undefined,
          loader: kind && kind !== 'vanilla' ? { kind, version: r.lv ?? undefined } : { kind: 'vanilla' }
        });
      }
    } finally {
      db.close();
    }
  } catch {
    /* старая схема или база занята — обойдёмся без неё */
  }
  return out;
}

const dbCache = new Map<string, Map<string, DbMeta>>();
function modrinthMeta(folder: string): DbMeta | undefined {
  const root = path.dirname(path.dirname(folder));
  let map = dbCache.get(root);
  if (!map) {
    map = readModrinthDb(root);
    dbCache.set(root, map);
  }
  return map.get(path.resolve(folder).toLowerCase());
}

/** Загрузчик из блока runtime XMCL: { minecraft, forge, neoForged, fabricLoader, quiltLoader }. */
function loaderFromRuntime(rt: Record<string, unknown>): LoaderSpec {
  const pairs: [string, LoaderKind][] = [
    ['neoForged', 'neoforge'],
    ['forge', 'forge'],
    ['fabricLoader', 'fabric'],
    ['quiltLoader', 'quilt']
  ];
  for (const [key, kind] of pairs) {
    const v = str(rt[key]);
    if (v) return { kind, version: v };
  }
  return { kind: 'vanilla' };
}

/** Читает описание одной сборки. null — папка пустая/битая. */
function scanProfileInstance(launcherId: string, launcherName: string, folder: string): ImportedInstanceInfo | null {
  const fallbackName = path.basename(folder);
  let name = fallbackName;
  let gameVersion: string | undefined;
  let loader: LoaderSpec = { kind: 'vanilla' };
  let hasConfig = false;

  if (launcherId === 'prism' || launcherId === 'multimc' || launcherId === 'polymc') {
    const cfg = parseCfg(path.join(folder, 'instance.cfg'));
    if (Object.keys(cfg).length) {
      hasConfig = true;
      name = cfg.name?.trim() || fallbackName;
    }
    const packFile = path.join(folder, 'mmc-pack.json');
    const pack = fs.existsSync(packFile) ? readMmcPack(packFile) : null;
    if (pack) {
      hasConfig = true;
      gameVersion = pack.gameVersion;
      if (pack.loader.kind !== 'vanilla') loader = pack.loader;
    }
    gameVersion ??= cfg.gameVersion || cfg.lastUsedVersion;
  } else if (launcherId === 'curseforge') {
    const j = safeJson<Record<string, unknown>>(path.join(folder, 'minecraftinstance.json'));
    if (j) {
      hasConfig = true;
      name = str(j.name)?.trim() || fallbackName;
      gameVersion = str(j.gameVersion) ?? str(j.minecraftVersion);
      const ml = j.baseModLoader ?? j.modLoader;
      if (ml && typeof ml === 'object') {
        const o = ml as Record<string, unknown>;
        const kind = asLoaderKind(o.type) ?? asLoaderKind(o.name);
        if (kind && kind !== 'vanilla') {
          const full = str(o.forgeVersion) ?? str(o.version) ?? str(o.name);
          loader = { kind, version: full?.replace(/^.*?(forge|neoforge|fabric|quilt)-/i, '') };
        }
      }
    }
  } else if (launcherId === 'modrinth') {
    const meta = modrinthMeta(folder);
    if (meta) {
      hasConfig = true;
      name = meta.name?.trim() || fallbackName;
      gameVersion = meta.gameVersion;
      loader = meta.loader;
    }
    const j = safeJson<Record<string, unknown>>(path.join(folder, 'profile.json'));
    if (j) {
      hasConfig = true;
      const meta2 = (j.metadata as Record<string, unknown> | undefined) ?? j;
      name = str(meta2.name)?.trim() || name;
      gameVersion ??= str(meta2.game_version) ?? str(meta2.minecraftVersion);
      const ld = meta2.loader;
      if (loader.kind === 'vanilla') {
        const kind = typeof ld === 'string' ? asLoaderKind(ld) : asLoaderKind((ld as Record<string, unknown> | undefined)?.type);
        if (kind && kind !== 'vanilla') loader = { kind, version: str(meta2.loader_version) ?? str((ld as Record<string, unknown> | undefined)?.version) };
      }
    }
  } else if (launcherId === '16launcher') {
    const j = safeJson<Record<string, unknown>>(path.join(folder, 'config.json'));
    if (j) {
      hasConfig = true;
      name = str(j.name)?.trim() || fallbackName;
      gameVersion = str(j.game_version);
      const kind = asLoaderKind(j.loader);
      if (kind && kind !== 'vanilla') loader = { kind, version: str(j.loader_version) };
    }
  } else if (launcherId === 'technic') {
    const v = safeJson<Record<string, unknown>>(path.join(folder, 'bin', 'version.json'));
    if (v) {
      hasConfig = true;
      const parsed = parseVersionId(str(v.id) ?? '');
      gameVersion = str(v.inheritsFrom) ?? parsed.gameVersion;
      loader = parsed.loader;
    }
  } else {
    // instance.json: ATLauncher / GDLauncher / XMCL / FTB — поля у всех разные, читаем всё
    const j =
      safeJson<Record<string, unknown>>(path.join(folder, 'instance.json')) ??
      safeJson<Record<string, unknown>>(path.join(folder, 'config.json'));
    if (j) {
      hasConfig = true;
      name = str(j.name)?.trim() || fallbackName;
      const rt = j.runtime && typeof j.runtime === 'object' ? (j.runtime as Record<string, unknown>) : null;
      // GDLauncher Carbon: game_configuration.version.{release, modloaders[]}
      const gc = (j.game_configuration as { version?: { release?: unknown; modloaders?: { type?: unknown; version?: unknown }[] } } | undefined)
        ?.version;
      gameVersion =
        str(rt?.minecraft) ??
        str(gc?.release) ??
        str(j.minecraft_version) ??
        str(j.minecraftVersion) ??
        str(j.mcVersion) ??
        str(j.gameVersion) ??
        (typeof j.version === 'object' ? gameVersionOf(j.version) : undefined) ??
        firstVersionSegment(str(j.instance_version) ?? str(j.version));
      let ld = rt ? loaderFromRuntime(rt) : loaderFromJson(j);
      if (ld.kind === 'vanilla' && gc?.modloaders?.[0]) {
        const kind = asLoaderKind(gc.modloaders[0].type);
        if (kind && kind !== 'vanilla') ld = { kind, version: str(gc.modloaders[0].version) };
      }
      if (ld.kind === 'vanilla' && str(j.modLoader)) ld = parseVersionId(String(j.modLoader)).loader;
      if (ld.kind !== 'vanilla') loader = ld;
    }
  }

  const mods = countJars(path.join(folder, 'mods'));
  const worlds = countDirs(path.join(folder, 'saves'));
  if (!hasConfig && mods === 0 && worlds === 0) return null;

  // Описания нет или в нём нет версии — смотрим лог последнего запуска
  if (!gameVersion || (loader.kind === 'vanilla' && mods > 0)) {
    const fromLog = inferFromLog(readLogHead(folder));
    gameVersion ??= fromLog.gameVersion;
    if (loader.kind === 'vanilla' && fromLog.loader) loader = fromLog.loader;
  }

  return {
    launcherId,
    launcherName,
    path: folder,
    name,
    gameVersion,
    loader,
    mods,
    worlds,
    sizeBytes: dirSize(folder),
    kind: 'profile'
  };
}

interface OfficialProfile {
  name?: unknown;
  lastVersionId?: unknown;
  gameDir?: unknown;
  type?: unknown;
}

/**
 * .minecraft-папка (официальный лаунчер, TLauncher, SKLauncher, HMCL, Legacy):
 * профили из launcher_profiles.json (у каждого может быть своя папка gameDir),
 * папки versions/<id>/ со своими модами («изоляция версий») и сама папка.
 */
function scanMinecraftRoot(def: LauncherDef, root: string): LauncherDetection | null {
  const looksLike =
    fs.existsSync(path.join(root, 'versions')) ||
    fs.existsSync(path.join(root, 'mods')) ||
    fs.existsSync(path.join(root, 'saves')) ||
    fs.existsSync(path.join(root, 'launcher_profiles.json'));
  if (!looksLike) return null;

  const instances: ImportedInstanceInfo[] = [];
  const seen = new Set<string>();
  const add = (folder: string, name: string, versionId?: string) => {
    const key = path.resolve(folder).toLowerCase();
    if (seen.has(key) || !fs.existsSync(folder)) return;
    const mods = countJars(path.join(folder, 'mods'));
    const worlds = countDirs(path.join(folder, 'saves'));
    // Общая папка .minecraft без модов и миров — переносить нечего
    if (key !== path.resolve(root).toLowerCase() && mods === 0 && worlds === 0) return;
    seen.add(key);
    let { gameVersion, loader } = versionId ? parseVersionId(versionId, root) : { gameVersion: undefined, loader: { kind: 'vanilla' } as LoaderSpec };
    if (!gameVersion || (loader.kind === 'vanilla' && mods > 0)) {
      const fromLog = inferFromLog(readLogHead(folder));
      gameVersion ??= fromLog.gameVersion;
      if (loader.kind === 'vanilla' && fromLog.loader) loader = fromLog.loader;
    }
    const own = key !== path.resolve(root).toLowerCase();
    instances.push({
      launcherId: def.id,
      launcherName: def.name,
      path: folder,
      name,
      gameVersion: gameVersion ?? (own ? undefined : versionFromVersionsDir(root)),
      loader,
      mods,
      worlds,
      sizeBytes: own ? dirSize(folder) : USER_DATA_DIRS.reduce((sum, d) => sum + dirSize(path.join(folder, d)), 0),
      kind: own ? 'profile' : 'minecraft'
    });
  };

  // 1) Профили официального формата: { profiles: { id: {...} } }
  const file = safeJson<{ profiles?: Record<string, OfficialProfile> } | { name?: unknown; version?: unknown }[]>(
    path.join(root, 'launcher_profiles.json')
  );
  // Старые лаунчеры пишут простой массив [{ name, version }]
  const profiles: OfficialProfile[] = Array.isArray(file)
    ? file.map((p) => ({ name: p?.name, lastVersionId: p?.version, type: 'custom' }))
    : file?.profiles
      ? Object.values(file.profiles)
      : [];
  let rootProfile: OfficialProfile | undefined;
  for (const p of profiles) {
    if (!p || typeof p !== 'object') continue;
    const gameDir = str(p.gameDir);
    const versionId = str(p.lastVersionId);
    if (gameDir && path.resolve(gameDir).toLowerCase() !== path.resolve(root).toLowerCase()) {
      add(gameDir, str(p.name) || path.basename(gameDir), versionId && !/^latest-/.test(versionId) ? versionId : undefined);
    } else if (!rootProfile || p.type === 'custom') {
      rootProfile = p;
    }
  }

  // 2) Изоляция версий: versions/<id>/ со своими mods/ или saves/
  try {
    for (const id of fs.readdirSync(path.join(root, 'versions'))) {
      const folder = path.join(root, 'versions', id);
      if (fs.existsSync(path.join(folder, 'mods')) || fs.existsSync(path.join(folder, 'saves'))) add(folder, id, id);
    }
  } catch {
    /* versions/ нет */
  }

  // 3) Сама папка — если в ней есть моды или миры (или больше ничего не нашлось)
  const rootMods = countJars(path.join(root, 'mods'));
  const rootWorlds = countDirs(path.join(root, 'saves'));
  if (rootMods || rootWorlds || !instances.length) {
    const versionId = str(rootProfile?.lastVersionId);
    add(root, str(rootProfile?.name) && rootProfile?.type === 'custom' ? String(rootProfile?.name) : 'Minecraft', versionId && !/^latest-/.test(versionId) ? versionId : undefined);
  }

  if (!instances.length) return null;
  return {
    id: def.id,
    name: def.name,
    path: root,
    instances,
    totalSize: instances.reduce((sum, i) => sum + i.sizeBytes, 0)
  };
}

/** Контейнер со сборками (Prism instances/, ATLauncher Instances/ и т.п.). */
function scanProfileContainer(def: LauncherDef, container: string): LauncherDetection | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(container, { withFileTypes: true });
  } catch {
    return null;
  }
  const instances: ImportedInstanceInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const folder = path.join(container, e.name);
    if (!def.markers.some((m) => fs.existsSync(path.join(folder, m)))) continue;
    const info = scanProfileInstance(def.id, def.name, folder);
    if (info) instances.push(info);
  }
  if (!instances.length) return null;
  return {
    id: def.id,
    name: def.name,
    path: container,
    instances,
    totalSize: instances.reduce((sum, i) => sum + i.sizeBytes, 0)
  };
}

async function scanLauncherRoot(def: LauncherDef, root: string): Promise<LauncherDetection | null> {
  if (def.kind === 'minecraft') return scanMinecraftRoot(def, root);
  const container = def.sub && fs.existsSync(path.join(root, def.sub)) ? path.join(root, def.sub) : root;
  return scanProfileContainer(def, container);
}

/** Тип лаунчера по содержимому папки (для портативных каталогов без стандартного пути). */
function defByContents(folder: string): LauncherDef | null {
  if (fs.existsSync(path.join(folder, 'minecraftinstance.json'))) return BY_ID['curseforge'];
  if (fs.existsSync(path.join(folder, 'instance.cfg'))) return BY_ID['prism'];
  if (fs.existsSync(path.join(folder, 'profile.json'))) return BY_ID['modrinth'];
  if (fs.existsSync(path.join(folder, 'instance.json'))) {
    const j = safeJson<Record<string, unknown>>(path.join(folder, 'instance.json')) ?? {};
    if (j.runtime || j.launcher === 'xmcl' || j.instance_schema_version !== undefined) return BY_ID['xmcl'];
    if (j.launcher_name === 'GDLauncher' || j.game_configuration) return BY_ID['gdlauncher'];
    if (j.mcVersion || j.modLoader) return BY_ID['ftb'];
    return BY_ID['atlauncher'];
  }
  const cfg = safeJson<Record<string, unknown>>(path.join(folder, 'config.json'));
  if (cfg && (cfg.game_version || cfg.loader)) return BY_ID['16launcher'];
  if (fs.existsSync(path.join(folder, 'mmc-pack.json'))) return BY_ID['prism'];
  if (fs.existsSync(path.join(folder, 'bin', 'version.json'))) return BY_ID['technic'];
  // Без описания, но с модами или мирами — неизвестный лаунчер, версия из лога
  if (fs.existsSync(path.join(folder, 'mods')) || fs.existsSync(path.join(folder, 'saves'))) return UNKNOWN_DEF;
  return null;
}

const UNKNOWN_DEF: LauncherDef = {
  id: 'folder',
  name: 'Папка с игрой',
  kind: 'profile',
  markers: ['mods', 'saves'],
  roots: () => []
};

function looksLikeMinecraftRoot(root: string): boolean {
  // mods/ один сам по себе не признак — в сборках Prism/ATLauncher и т.п. он тоже есть.
  return (
    fs.existsSync(path.join(root, 'versions')) || fs.existsSync(path.join(root, 'launcher_profiles.json'))
  );
}

/** Портативные папки: .minecraft, одиночная сборка или контейнер со сборками. */
async function detectPortablePaths(extraPaths: string[]): Promise<LauncherDetection[]> {
  const out: LauncherDetection[] = [];
  for (const extra of extraPaths) {
    const root = path.resolve(extra);
    try {
      if (!fs.statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }

    if (looksLikeMinecraftRoot(root)) {
      const def = hasTlMarker(root) ? TL_DEF : BY_ID['minecraft'];
      const det = scanMinecraftRoot(def, root);
      if (det) out.push(det);
      continue;
    }

    // Одна сборка прямо в этой папке
    const selfDef = defByContents(root);
    if (selfDef) {
      const info = scanProfileInstance(selfDef.id, selfDef.name, root);
      if (info) {
        out.push({ id: selfDef.id, name: selfDef.name, path: root, instances: [info], totalSize: info.sizeBytes });
      }
      continue;
    }

    // Контейнер: сначала подпапки instances/Instances/profiles, потом сама папка
    const containers = ['instances', 'Instances', 'profiles']
      .map((s) => path.join(root, s))
      .filter((c) => fs.existsSync(c));
    for (const container of [...containers, root]) {
      let dirEntries: fs.Dirent[];
      try {
        dirEntries = fs.readdirSync(container, { withFileTypes: true });
      } catch {
        continue;
      }
      const instances: ImportedInstanceInfo[] = [];
      const counts = new Map<string, number>();
      for (const e of dirEntries) {
        if (!e.isDirectory()) continue;
        const folder = path.join(container, e.name);
        const def = defByContents(folder);
        if (!def) continue;
        const info = scanProfileInstance(def.id, def.name, folder);
        if (info) {
          instances.push(info);
          counts.set(def.id, (counts.get(def.id) ?? 0) + 1);
        }
      }
      if (instances.length) {
        const [dominantId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const def = BY_ID[dominantId] ?? UNKNOWN_DEF;
        out.push({
          id: def.id,
          name: def.name,
          path: container,
          instances,
          totalSize: instances.reduce((sum, i) => sum + i.sizeBytes, 0)
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Находит лаунчеры и их сборки. Только чтение, на диск ничего не записывает.
 * extraPaths — портативные папки, которые пользователь укажет сам.
 */
export async function detectLaunchers(opts?: { extraPaths?: string[] }): Promise<LauncherDetection[]> {
  const env = readEnvRoots();
  const out: LauncherDetection[] = [];
  const seenRoots = new Set<string>();

  for (const def of LAUNCHERS) {
    for (const root of def.roots(env)) {
      if (!root) continue;
      const resolved = path.resolve(root);
      if (seenRoots.has(resolved) || !fs.existsSync(resolved)) continue;
      seenRoots.add(resolved);
      const det = await scanLauncherRoot(def, resolved);
      if (det) out.push(det);
    }
  }

  // TLauncher/SKLauncher — тот же .minecraft, отдельная карточка, если есть маркеры
  const mcRoot = env.appdata ? path.resolve(path.join(env.appdata, '.minecraft')) : '';
  if (mcRoot && seenRoots.has(mcRoot) && hasTlMarker(mcRoot)) {
    const det = scanMinecraftRoot(TL_DEF, mcRoot);
    if (det) out.push(det);
  }

  if (opts?.extraPaths?.length) {
    for (const det of await detectPortablePaths(opts.extraPaths)) {
      if (!out.some((d) => d.path === det.path)) out.push(det);
    }
  }
  return out;
}

/* ------------------------------ Копирование / ссылки ------------------------------ */

// Флаг hardlink для copyFileSync; в некоторых версиях @types/node его нет
// в типизации constants — в этом случае просто копируем.
const HARDLINK_FLAG: number | undefined = (fs.constants as { COPYFILE_HARDLINK?: number }).COPYFILE_HARDLINK;

function copyOne(src: string, dest: string, state: CopyState): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (state.mode === 'copy' || HARDLINK_FLAG === undefined) {
    fs.copyFileSync(src, dest);
    return;
  }
  try {
    fs.copyFileSync(src, dest, HARDLINK_FLAG);
  } catch {
    // hardlink недоступен (разные диски, права, read-only) — честно копируем
    fs.copyFileSync(src, dest);
    if (!state.linkWarning) {
      state.linkWarning = true;
      state.warnings.push('Часть файлов нельзя было завязать в hardlink — скопированы');
    }
  }
}

function copyTree(srcDir: string, destDir: string, state: CopyState): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const name = e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(name.toLowerCase())) continue;
      copyTree(path.join(srcDir, name), path.join(destDir, name), state);
    } else if (e.isFile()) {
      if (isDeniedFile(name) || name.startsWith('.ploxel')) continue;
      copyOne(path.join(srcDir, name), path.join(destDir, name), state);
    }
  }
}

function copyTopFile(src: string, dest: string, name: string, state: CopyState): void {
  const from = path.join(src, name);
  if (fs.existsSync(from) && !isDeniedFile(name)) copyOne(from, path.join(dest, name), state);
}

function findIcon(src: string, launcherId: string): string | undefined {
  if (launcherId === 'curseforge') {
    const j = safeJson<Record<string, unknown>>(path.join(src, 'minecraftinstance.json'));
    const name = str(j?.iconFilename);
    if (name && !name.includes('..') && fs.existsSync(path.join(src, name))) return path.join(src, name);
  }
  for (const name of ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp']) {
    const f = path.join(src, name);
    if (fs.existsSync(f)) return f;
  }
  return undefined;
}

function extractJvmMemory(src: string, launcherId: string): { jvmArgs?: string; memoryMb?: number } {
  const out: { jvmArgs?: string; memoryMb?: number } = {};
  const cfgFile = path.join(src, 'instance.cfg');
  if (fs.existsSync(cfgFile)) {
    const cfg = parseCfg(cfgFile);
    const args = cfg.jvmArgs || cfg.jvmArgs64 || cfg.additionalLaunchArgs;
    if (args?.trim()) out.jvmArgs = args.trim();
    const mem = Number(cfg.maxMemAlloc ?? cfg.memory ?? '');
    if (Number.isFinite(mem) && mem > 0) out.memoryMb = Math.round(mem);
  }
  const jsonFiles =
    launcherId === 'curseforge'
      ? ['minecraftinstance.json']
      : launcherId === 'modrinth'
        ? ['profile.json']
        : ['instance.json'];
  for (const f of jsonFiles) {
    const j = safeJson<Record<string, unknown>>(path.join(src, f));
    if (!j) continue;
    out.jvmArgs ??= str(j.jvmArgs);
    const mem = Number(j.memoryMb ?? j.maxMemAlloc ?? j.maxMemory ?? '');
    if (Number.isFinite(mem) && mem > 0) out.memoryMb ??= Math.round(mem);
  }
  return out;
}

/* ------------------------------ Импорт сборки ------------------------------ */

const IMPORT_MARKER = '.ploxel-import.json';

interface ImportMarker {
  sourcePath: string;
  launcherId: string;
  name: string;
  importedAt: string;
}

function readImportMarker(instanceId: string): ImportMarker | null {
  return safeJson<ImportMarker>(path.join(instanceDir(instanceId), IMPORT_MARKER));
}

function findImportedBySource(sourcePath: string): string | null {
  for (const inst of listInstances()) {
    const marker = readImportMarker(inst.id);
    if (marker?.sourcePath === sourcePath) return inst.id;
  }
  return null;
}

/**
 * Переносит найденную сборку в Ploxel через createInstance.
 * Загрузчик не скачивается — если он не установлен, сборка остаётся как есть.
 * Оригиналы не изменяются и не удаляются.
 */
export async function importDetected(info: ImportedInstanceInfo, options: ImportOptions): Promise<ImportResult> {
  const src = path.resolve(info.path);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error('Исходная папка сборки не найдена');
  }

  const existing = findImportedBySource(src);
  if (existing) throw new Error(`Эта сборка уже импортирована (${existing})`);

  const warnings: string[] = [];
  const gameVersion = info.gameVersion || versionFromVersionsDir(src) || 'latest';
  if (!info.gameVersion && !versionFromVersionsDir(src)) {
    warnings.push('Версия игры не определена — указана «latest», проверьте в настройках сборки');
  }

  const instance = await createInstance({
    name: info.name,
    gameVersion,
    loader: info.loader ?? { kind: 'vanilla' },
    source: { kind: 'import' }
  });
  const dest = instanceDir(instance.id);
  const state: CopyState = { mode: options.mode, warnings, linkWarning: false };

  for (const dir of ALWAYS_DIRS) {
    const from = path.join(src, dir);
    if (fs.existsSync(from)) copyTree(from, path.join(dest, dir), state);
  }
  if (options.worlds) {
    const from = path.join(src, 'saves');
    if (fs.existsSync(from)) copyTree(from, path.join(dest, 'saves'), state);
  }
  if (options.settings) copyTopFile(src, dest, 'options.txt', state);
  if (options.servers) copyTopFile(src, dest, 'servers.dat', state);

  const icon = findIcon(src, info.launcherId);
  if (icon) {
    try {
      await setInstanceCover(instance.id, icon);
    } catch {
      warnings.push('Не удалось скопировать иконку сборки');
    }
  }

  if (options.jvm || options.memory) {
    const jm = extractJvmMemory(src, info.launcherId);
    const patch: { jvmArgs?: string; memoryMb?: number } = {};
    if (options.jvm && jm.jvmArgs) patch.jvmArgs = jm.jvmArgs;
    if (options.memory && jm.memoryMb) patch.memoryMb = jm.memoryMb;
    if (Object.keys(patch).length) await updateInstance(instance.id, patch);
  }

  const mods = scanMods(instance.id);
  await persistMods(instance.id, mods);

  const marker: ImportMarker = {
    sourcePath: src,
    launcherId: info.launcherId,
    name: info.name,
    importedAt: new Date().toISOString()
  };
  await fsp.writeFile(path.join(dest, IMPORT_MARKER), JSON.stringify(marker, null, 2), 'utf8');

  return {
    instanceId: instance.id,
    name: instance.name,
    importedMods: countJars(path.join(dest, 'mods')),
    importedWorlds: countDirs(path.join(dest, 'saves')),
    warnings
  };
}

/* ------------------------------ Архивы-модпаки ------------------------------ */

/** Формат архива: .mrpack (modrinth.index.json) или CurseForge (manifest.json). */
export function detectArchiveFormat(file: string): 'mrpack' | 'curseforge' {
  const zip = new AdmZip(file);
  if (zip.getEntry('modrinth.index.json')) return 'mrpack';
  if (zip.getEntry('manifest.json')) return 'curseforge';
  throw new Error('Это не модпак: не найдены modrinth.index.json или manifest.json');
}

/**
 * Защита от zip-slip: каждое имя в архиве должно оставаться внутри одной папки.
 * Проверяем заранее, до разбора и установки (установка — за modpack.ts).
 */
function assertNoZipSlip(file: string): void {
  const zip = new AdmZip(file);
  const root = path.resolve(path.dirname(file));
  for (const entry of zip.getEntries()) {
    const target = path.resolve(root, entry.entryName);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Небезопасный путь в архиве (zip-slip): ${entry.entryName}`);
    }
  }
}

/**
 * Установка .mrpack / архива CurseForge. Сначала проверяем формат и zip-slip,
 * затем передаём в существующий installModpackArchive.
 * ImportOptions к архивам неприменимы (файлы извлекаются заново) — параметр
 * оставлен для единообразия API.
 */
export async function importArchive(file: string, options?: Partial<ImportOptions>): Promise<Instance> {
  void options;
  if (!fs.existsSync(file)) throw new Error('Архив не найден');
  detectArchiveFormat(file);
  assertNoZipSlip(file);
  return installModpackArchive(file, () => {});
}

/* ------------------------------ Опознание модов по хэшу ------------------------------ */

export interface ModMatch {
  fileName: string;
  sha1: string;
  /** Версия из Modrinth, если файл там найден; null — неизвестен или нет сети. */
  version: CatalogVersion | null;
}

/**
 * Опознаёт моды по SHA1 через Modrinth `version_file/{sha1}` — для подсказок
 * об обновлениях. Вызывается явно (не часть импорта) и только при доступной
 * сети: без сети возвращает network: false и нулевые совпадения.
 */
export async function matchMods(instanceId: string): Promise<{ network: boolean; matches: ModMatch[] }> {
  const dir = path.join(instanceDir(instanceId), 'mods');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar'));
  } catch {
    return { network: true, matches: [] };
  }

  let online = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${MODRINTH_BASE}/version_file/ping?algorithm=sha1`, { signal: ctrl.signal });
    clearTimeout(timer);
    void res;
  } catch {
    online = false;
  }

  const matches: ModMatch[] = [];
  for (const file of files) {
    let sha1: string;
    try {
      sha1 = await sha1File(path.join(dir, file));
    } catch {
      continue;
    }
    matches.push({ fileName: file, sha1, version: online ? await getModrinthVersionByHash(sha1) : null });
  }
  return { network: online, matches };
}
