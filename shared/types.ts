// Общие типы для main и renderer. Ничего из Electron здесь быть не должно.

import type { ColorMode, ThemeId } from './theme';
export type { ColorMode, ThemeId } from './theme';

export type MotionLevel = 'off' | 'reduced' | 'full';

export interface AccentColor {
  id: string;
  name: string;
  /** HEX-цвет акцента */
  value: string;
  custom?: boolean;
}

export interface GradientDef {
  id: string;
  name: string;
  /** 2–3 цвета + угол в градусах */
  colors: string[];
  angle: number;
  custom?: boolean;
}

export type BackgroundKind = 'theme' | 'solid' | 'gradient' | 'animated' | 'media';

export interface BackgroundSettings {
  kind: BackgroundKind;
  /** для kind = solid */
  color: string;
  /** для kind = gradient */
  gradientId: string;
  /** для kind = animated: aurora | waves | fireflies | grid | rain | orbits */
  animatedId: string;
  /** 0..1 — насыщенность анимированного фона */
  intensity: number;
  /** для kind = media: файл в папке backgrounds (картинка, GIF или видео) */
  mediaFile?: string;
  mediaType?: 'image' | 'video';
  /** 0..1 — затемнение своего фона подложкой темы */
  mediaDim?: number;
}

export interface AppearanceSettings {
  theme: ThemeId;
  /** светлый, тёмный или как в Windows */
  colorMode: ColorMode;
  /** устарело: то же, что colorMode === 'system' (для старых файлов экспорта) */
  followSystemTheme: boolean;
  accentId: string;
  gradientId: string;
  customAccents: AccentColor[];
  customGradients: GradientDef[];
  background: BackgroundSettings;
  fontId: string;
  textScale: number; // 0.8 – 1.5
  radiusScale: number; // 0 – 1.6
  panelOpacity: number; // 0.6 – 1
  motion: MotionLevel;
  density: 'comfortable' | 'compact';
  /** Порядок блоков по экранам (drag-and-drop). Ключ — id экрана. */
  layout: Record<string, string[]>;
  /** выбрана тема «Кастомная»: theme — её основа, акцент и фон — свои */
  custom?: boolean;
  /** сохранённая кастомная тема — к ней можно вернуться после готовой темы */
  customTheme?: CustomThemeSnapshot | null;
}

export interface CustomThemeSnapshot {
  base: ThemeId;
  accentId: string;
  background: BackgroundSettings;
}

export interface GeneralSettings {
  language: string;
  closeLauncherOnGameStart: 'keep' | 'minimize' | 'close';
  assistantEnabled: boolean;
  /** автоматически докачивать обязательные зависимости модов */
  dependencyHelper: boolean;
  showSnapshots: boolean;
  telemetry: false;
  memoryMb: number;
  autoUpdateLauncher: boolean;
  confirmDeleteInstance: boolean;
  defaultInstanceId: string | null;
  /** обучение при первом запуске пройдено или пропущено */
  onboardingDone: boolean;
}

export interface DownloadMirrors {
  mojang: string;
  modrinth: string;
  curseforge: string;
}

export interface DownloadSettings {
  /** сколько файлов качать одновременно */
  maxConcurrent: number;
  /** ограничение скорости в КБ/с, 0 — без ограничения */
  speedLimitKbps: number;
  mirrors: DownloadMirrors;
  /** сколько потоков на один крупный файл (0 — выключено) */
  rangeThreads: number;
}

export interface ControlsSettings {
  /** Изменённые пользователем привязки: id клавиши → key.keyboard.w / key.mouse.left. */
  keybinds: Record<string, string>;
  /** Подставлять общие привязки в новые сборки при создании. */
  applyToNewInstances: boolean;
}

export interface JavaSettings {
  /** путь к java.exe, выбранный вручную; пусто — автоопределение */
  customJavaPath: string;
  jvmArgs: string;
  autoDownloadJava: boolean;
}

export interface AiSettings {
  /** 'none' | 'openai-compatible' | 'config' */
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  rememberKey: boolean;
  /** почта для MyMemory: лимит перевода 50 000 символов в день вместо 5 000 */
  translateEmail?: string;
}

export interface Settings {
  schemaVersion: number;
  appearance: AppearanceSettings;
  general: GeneralSettings;
  java: JavaSettings;
  ai: AiSettings;
  downloads: DownloadSettings;
  controls: ControlsSettings;
}

export interface AppInfo {
  version: string;
  platform: string;
  /** true для установленной сборки (не запуск из папки разработки) */
  packaged: boolean;
  dataRoot: string;
  totalMemMb: number;
  freeMemMb: number;
  config: { microsoftClientId: boolean; curseforgeKey: boolean; aiKey: boolean };
  systemTheme: 'light' | 'dark';
  systemAnimations: boolean;
}

export interface Account {
  id: string;
  /** elyby — аккаунт Ely.by: свои скины через authlib-injector */
  type: 'microsoft' | 'offline' | 'elyby';
  name: string;
  uuid: string;
  createdAt: string;
  /** microsoft и elyby: срок действия токена */
  expiresAt?: string;
  skinUrl?: string;
}

export type LoaderKind = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';

export interface LoaderSpec {
  kind: LoaderKind;
  version?: string;
}

export interface Instance {
  id: string;
  name: string;
  gameVersion: string;
  loader: LoaderSpec;
  createdAt: string;
  lastPlayedAt?: string;
  favorite: boolean;
  iconHue: number;
  /** описание/источник (modpack) */
  source?: { kind: 'manual' | 'modrinth' | 'curseforge' | 'import'; projectId?: string; versionId?: string };
  memoryMb?: number;
  jvmArgs?: string;
  /** путь к java.exe, выбранный для этой сборки */
  javaPath?: string;
  /** файл обложки внутри папки сборки (cover.png и т.п.) */
  coverImage?: string;
  /** обложка как data URL — заполняется при чтении списка */
  coverDataUrl?: string;
  serverAddress?: string;
  modpackFile?: string;
  playtimeMinutes?: number;
}

export interface InstalledMod {
  id: string;
  instanceId: string;
  fileName: string;
  name: string;
  version: string;
  versionId?: string;
  sha1?: string;
  /** Отпечаток файла для CurseForge (MurmurHash2) */
  fingerprint?: number;
  /** когда файл без источника последний раз искали в каталогах (ISO) */
  identifiedAt?: string;
  kind: 'mod' | 'resourcepack' | 'shader' | 'modpack';
  projectId?: string;
  source: 'modrinth' | 'curseforge' | 'local';
  enabled: boolean;
  iconUrl?: string;
  dependencies?: { projectId: string; versionId?: string; required: boolean }[];
  installedAt: string;
  /** путь к бэкапу прошлой версии (относительно папки сборки) */
  previousVersionFile?: string;
  previousVersion?: string;
  previousVersionId?: string;
  previousSha1?: string;
}

/** Снимок экрана сборки (папка screenshots). */
export interface ScreenshotInfo {
  file: string;
  takenAt: string;
  /** название мира или адрес сервера */
  world?: string;
  /** снимок сделан на сервере */
  server?: boolean;
  /** мир угадан по времени (снимок сделан до того, как лаунчер начал их отмечать) */
  guessed?: boolean;
  size: number;
}

export interface DownloadTask {
  id: string;
  title: string;
  detail?: string;
  total: number;
  done: number;
  status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
  error?: string;
  speedBps?: number;
  etaSeconds?: number;
  priority?: 'high' | 'normal' | 'low';
  group?: string;
  bytesDone?: number;
  bytesTotal?: number;
  canCancel?: boolean;
}

export interface LogLine {
  ts: number;
  line: string;
  stream: 'out' | 'err' | 'launcher';
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  date: string;
  url: string;
  image?: string;
  gradient: [string, string];
}

/** Запись из ленты заметок к обновлениям Java (launchercontent.mojang.com). */
export interface PatchNoteItem {
  id: string;
  title: string;
  version: string;
  type: 'release' | 'snapshot';
  date: string;
  summary: string;
}

export interface PatchNote {
  id: string;
  title: string;
  version: string;
  /** Текст заметок в markdown */
  body: string;
}

export interface WorldInfo {
  instanceId: string;
  folder: string;
  name: string;
  sizeBytes: number;
  lastPlayed?: string;
  gameVersion?: string;
  icon?: string;
  isHardcore?: boolean;
}

export interface CatalogProject {
  source: 'modrinth' | 'curseforge';
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl?: string;
  downloads: number;
  author: string;
  categories: string[];
  projectType: 'mod' | 'modpack' | 'resourcepack' | 'shader';
  loaders: string[];
  gameVersions: string[];
  updatedAt: string;
  url: string;
  /** описание проекта в markdown (Modrinth) — для внутренней страницы */
  body?: string;
  gallery?: string[];
}

export interface CatalogVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  files: { url: string; fileName: string; size: number; primary: boolean; hashes?: Record<string, string> }[];
  dependencies: { projectId: string; versionId?: string; required: boolean; type?: string }[];
  datePublished: string;
  changelog?: string;
}

export interface CatalogSearchQuery {
  source: 'modrinth' | 'curseforge';
  projectType: 'mod' | 'modpack' | 'resourcepack' | 'shader';
  query: string;
  gameVersion?: string;
  loader?: string;
  category?: string;
  sort: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';
  offset: number;
  limit: number;
}

export interface CatalogSearchResult {
  hits: CatalogProject[];
  total: number;
  offset: number;
  limit: number;
}

export interface VersionSummary {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  releaseTime: string;
}

export interface SkinLayers {
  hat: boolean;
  jacket: boolean;
  sleeves: boolean;
  pants: boolean;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warning';
  title: string;
  description?: string;
}

/* --------------------------- Зависимости модов --------------------------- */

export type DependencySource = 'modrinth' | 'curseforge';

export interface DependencyItem {
  key: string;
  source: DependencySource;
  projectId: string;
  projectName: string;
  iconUrl?: string;
  versionId?: string;
  versionNumber?: string;
  fileName?: string;
  sizeBytes?: number;
  required: boolean;
  optional: boolean;
  embedded: boolean;
  incompatible: boolean;
  installed: boolean;
  selected: boolean;
  depth: number;
  note?: string;
}

export interface DependencyPlan {
  root: DependencyItem | null;
  items: DependencyItem[];
  warnings: string[];
  conflicts: { left: string; right: string; reason: string }[];
}

export interface JarMetadata {
  file: string;
  id?: string;
  name?: string;
  version?: string;
  provides: string[];
  depends: Record<string, string[]>;
  breaks: Record<string, string[]>;
  loaders: string[];
}

export type BuildIssueKind = 'missing' | 'outdated' | 'conflict' | 'duplicate' | 'incompatible';

export interface BuildIssue {
  id: string;
  kind: BuildIssueKind;
  title: string;
  explanation: string;
  changes: string;
  risks: string;
  confidence: 'high' | 'medium' | 'low';
  fixable: boolean;
  payload: Record<string, unknown>;
}

/* ------------------------------ Разбор падений ------------------------------ */

export interface CrashFix {
  type:
    | 'disable-mod'
    | 'install-dependency'
    | 'increase-memory'
    | 'download-java'
    | 'redownload-files'
    | 'switch-loader'
    | 'open-mods-page';
  [key: string]: unknown;
}

export interface CrashCause {
  id: string;
  title: string;
  explanation: string;
  change: string;
  risks: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  fix?: CrashFix;
}

export interface CrashAnalysis {
  causes: CrashCause[];
  scannedFiles: string[];
  logTail: string[];
}

/* --------------------------- Импорт из лаунчеров --------------------------- */

export interface ImportedInstanceInfo {
  launcherId: string;
  launcherName: string;
  path: string;
  name: string;
  gameVersion?: string;
  loader?: LoaderSpec;
  mods: number;
  worlds: number;
  sizeBytes: number;
  kind: 'profile' | 'minecraft';
}

export interface LauncherDetection {
  id: string;
  name: string;
  path: string;
  instances: ImportedInstanceInfo[];
  totalSize: number;
}

export interface ImportOptions {
  mode: 'copy' | 'link';
  worlds: boolean;
  settings: boolean;
  servers: boolean;
  jvm: boolean;
  memory: boolean;
}

export interface ImportResult {
  instanceId: string;
  name: string;
  importedMods: number;
  importedWorlds: number;
  warnings: string[];
  /** откуда перенесли и можно ли убрать сборку в старом лаунчере */
  sourcePath?: string;
  launcherName?: string;
  sourceSize?: number;
  sourceDeletable?: boolean;
}

/* ------------------------------ Прочее ------------------------------ */

export interface OnboardingState {
  done: boolean;
  skipped: boolean;
  version: number;
}

export interface AccountView extends Account {
  sessionState: 'valid' | 'expired' | 'offline';
}