import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './paths';
import type { Settings } from '../../shared/types';
import { migrateAppearance } from '../../shared/theme';

const FILE = 'settings.json';

export const defaultSettings = (): Settings => ({
  schemaVersion: 2,
  appearance: {
    theme: 'cream',
    colorMode: 'light',
    followSystemTheme: false,
    accentId: 'sage',
    gradientId: 'meadow',
    customAccents: [],
    customGradients: [],
    background: { kind: 'theme', color: '#EEE5D6', gradientId: 'meadow', animatedId: 'aurora', intensity: 0.7 },
    fontId: 'onest',
    textScale: 1,
    radiusScale: 1,
    panelOpacity: 1,
    motion: 'full',
    density: 'comfortable',
    layout: {},
    custom: false,
    customTheme: null
  },
  general: {
    language: 'ru',
    closeLauncherOnGameStart: 'keep',
    assistantEnabled: true,
    dependencyHelper: true,
    showSnapshots: false,
    telemetry: false,
    memoryMb: 4096,
    autoUpdateLauncher: true,
    confirmDeleteInstance: true,
    defaultInstanceId: null,
    onboardingDone: false
  },
  java: { customJavaPath: '', jvmArgs: '-XX:+UseG1GC', autoDownloadJava: true },
  ai: { provider: 'none', baseUrl: '', model: '', apiKey: '', rememberKey: false, translateEmail: '' },
  downloads: {
    maxConcurrent: 6,
    speedLimitKbps: 0,
    rangeThreads: 0,
    mirrors: { mojang: '', modrinth: '', curseforge: '' }
  },
  controls: {
    keybinds: {},
    applyToNewInstances: true
  }
});

let cache: Settings | null = null;

export function settingsFile(): string {
  return path.join(getRoot(), FILE);
}

export function loadSettings(): Settings {
  if (cache) return cache;
  const base = defaultSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (isObj(raw) && isObj(raw.appearance)) raw.appearance = migrateAppearance(raw.appearance);
    cache = deepMerge(base, raw);
  } catch {
    cache = base;
  }
  return cache;
}

export function saveSettings(next: Partial<Settings>): Settings {
  return write(deepMerge(loadSettings(), next));
}

/**
 * Привязки клавиш заменяются целиком, а не сливаются: иначе сброс одной
 * клавиши (ключ просто удалён из объекта) и «Сбросить всё» с пустым объектом
 * оставляли бы старые значения в settings.json.
 */
export function replaceKeybinds(keybinds: Record<string, string>): Settings {
  const current = loadSettings();
  return write({ ...current, controls: { ...current.controls, keybinds: { ...keybinds } } });
}

function write(next: Settings): Settings {
  cache = next;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, settingsFile());
  return cache;
}

export function resetSettings(): Settings {
  cache = defaultSettings();
  return write(cache);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge<T>(target: T, patch: unknown): T {
  if (!isObj(target) || !isObj(patch)) return (patch === undefined ? target : (patch as T));
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj((target as Record<string, unknown>)[k])) {
      out[k] = deepMerge((target as Record<string, unknown>)[k], v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}