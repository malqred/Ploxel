// Типы манифестов Mojang. Описаны только используемые поля.
// Источник: https://minecraft.wiki/w/Client.json и version_manifest_v2.json

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: VersionSummaryRaw[];
}

export interface VersionSummaryRaw {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1?: string;
}

export interface OsRule {
  name?: 'windows' | 'osx' | 'linux';
  arch?: 'x86' | 'x86_64' | 'arm64';
  version?: string;
}

export interface Rule {
  action: 'allow' | 'deny';
  os?: OsRule;
  features?: Record<string, boolean>;
}

export interface LibraryDownload {
  path?: string;
  sha1?: string;
  size?: number;
  url?: string;
}

export interface Library {
  name: string;
  downloads?: {
    artifact?: LibraryDownload;
    classifiers?: Record<string, LibraryDownload>;
  };
  natives?: Record<string, string>;
  rules?: Rule[];
  extract?: { exclude?: string[] };
  url?: string;
}

export type ArgumentValue = string | string[];

export interface ArgumentEntry {
  rules?: Rule[];
  value: ArgumentValue;
}

export interface VersionJson {
  id: string;
  type?: string;
  mainClass: string;
  inheritsFrom?: string;
  assetIndex?: { id: string; sha1?: string; size?: number; url: string; totalSize?: number };
  assets?: string;
  downloads?: { client?: LibraryDownload; server?: LibraryDownload };
  libraries: Library[];
  arguments?: { game: (string | ArgumentEntry)[]; jvm: (string | ArgumentEntry)[] };
  minecraftArguments?: string;
  javaVersion?: { component?: string; majorVersion?: number };
  logging?: {
    client?: { argument: string; file: LibraryDownload & { id: string } };
  };
  complianceLevel?: number;
  releaseTime?: string;
  time?: string;
}

export interface AssetObject {
  hash: string;
  size: number;
}

export interface AssetIndex {
  objects: Record<string, AssetObject>;
  virtual?: boolean;
  map_to_resources?: boolean;
}

/** all.json: платформа → компонент → варианты рантайма. */
export interface RuntimeManifest {
  [platform: string]: {
    [component: string]: {
      version: { name: string; released: string };
      manifest: { url: string; sha1?: string; size?: number };
      availability?: { group: number; progress: number };
    }[];
  };
}

export interface RuntimeFile {
  type: 'directory' | 'file' | 'link';
  executable?: boolean;
  downloads?: { raw: LibraryDownload; lzma?: LibraryDownload };
  target?: string;
}

export interface RuntimeFilesManifest {
  files: Record<string, RuntimeFile>;
}

export interface RuleContext {
  os: 'windows' | 'osx' | 'linux';
  arch: 'x86' | 'x86_64' | 'arm64';
  osVersion?: string;
  features: Record<string, boolean>;
}

/** Итоговое описание запуска после слияния inheritFrom и разбора правил. */
export interface ResolvedVersion {
  id: string;
  mainClass: string;
  libraries: Library[];
  jvmArgs: (string | ArgumentEntry)[];
  gameArgs: (string | ArgumentEntry)[];
  minecraftArguments?: string;
  assetIndex?: VersionJson['assetIndex'];
  client?: LibraryDownload;
  javaVersion?: { component?: string; majorVersion?: number };
  logging?: VersionJson['logging'];
  baseId: string;
  type?: string;
}