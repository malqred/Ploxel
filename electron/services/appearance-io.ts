import type { AppearanceSettings, GradientDef, AccentColor } from '../../shared/types';
import { defaultSettings } from './settings';
import { COLOR_MODES, THEME_IDS, migrateAppearance } from '../../shared/theme';

/**
 * Импорт/экспорт внешнего вида.
 * Файл — JSON со schemaVersion. Никакого исполняемого кода: только данные,
 * каждое поле проверяется по белому списку и допустимым диапазонам.
 */

export const APPEARANCE_SCHEMA = 1;

export const APPEARANCE_KEYS = [
  'theme',
  'colorMode',
  'followSystemTheme',
  'accentId',
  'gradientId',
  'customAccents',
  'customGradients',
  'background',
  'fontId',
  'textScale',
  'radiusScale',
  'panelOpacity',
  'motion',
  'density',
  'layout'
] as const;

export function exportAppearance(appearance: AppearanceSettings): string {
  const payload = { schemaVersion: APPEARANCE_SCHEMA, exportedBy: 'Ploxel', appearance };
  return JSON.stringify(payload, null, 2);
}

const HEX = /^#[0-9a-f]{6}$/i;
const THEMES: readonly string[] = THEME_IDS;
const MOTION = ['off', 'reduced', 'full'];
const KINDS = ['theme', 'solid', 'gradient', 'animated'];
const ANIMATED = ['aurora', 'waves', 'fireflies', 'grid', 'rain', 'orbits'];
const FONT_IDS = [
  'onest',
  'inter',
  'manrope',
  'golos',
  'nunito',
  'rubik',
  'montserrat',
  'ptsans',
  'comfortaa',
  'lora',
  'ptserif',
  'playfair',
  'cormorant',
  'merriweather',
  'jetbrains'
];

export interface ImportResult {
  ok: boolean;
  error?: string;
  appearance?: AppearanceSettings;
}

export function importAppearance(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Файл повреждён: это не корректный JSON.' };
  }
  const data = raw as { schemaVersion?: number; appearance?: Record<string, unknown> };
  if (data?.schemaVersion !== APPEARANCE_SCHEMA) {
    return { ok: false, error: `Неизвестная версия схемы: ${String(data?.schemaVersion)}. Обновите лаунчер.` };
  }
  if (!data.appearance || typeof data.appearance !== 'object') return { ok: false, error: 'В файле нет блока appearance.' };
  // Файлы старых версий: «Полночь» → Крем + тёмный режим и т. п.
  const src = migrateAppearance(data.appearance);

  const base = defaultSettings().appearance;
  const out: AppearanceSettings = { ...base, layout: {} };
  const warnings: string[] = [];

  const pick = <T>(key: string, valid: (v: unknown) => v is T, target: T): T => {
    const v = src[key];
    if (v === undefined) return target;
    if (valid(v)) return v;
    warnings.push(key);
    return target;
  };

  const isStr = (v: unknown): v is string => typeof v === 'string';
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  out.theme = pick('theme', (v): v is AppearanceSettings['theme'] => isStr(v) && THEMES.includes(v), base.theme);
  out.colorMode = pick('colorMode', (v): v is AppearanceSettings['colorMode'] => COLOR_MODES.includes(v as never), base.colorMode);
  out.followSystemTheme = out.colorMode === 'system';
  out.accentId = pick('accentId', isStr, base.accentId).slice(0, 64);
  out.gradientId = pick('gradientId', isStr, base.gradientId).slice(0, 64);
  out.fontId = pick('fontId', (v): v is string => isStr(v) && FONT_IDS.includes(v), base.fontId);
  out.motion = pick('motion', (v): v is AppearanceSettings['motion'] => isStr(v) && MOTION.includes(v), base.motion);
  out.density = pick('density', (v): v is AppearanceSettings['density'] => v === 'compact' || v === 'comfortable', base.density);

  const num = (key: string, min: number, max: number, fallback: number) => {
    const v = src[key];
    if (!isNum(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  };
  out.textScale = num('textScale', 0.8, 1.5, base.textScale);
  out.radiusScale = num('radiusScale', 0, 1.6, base.radiusScale);
  out.panelOpacity = num('panelOpacity', 0.6, 1, base.panelOpacity);

  if (Array.isArray(src.customAccents)) {
    out.customAccents = (src.customAccents as unknown[])
      .filter(
        (a): a is AccentColor =>
          !!a &&
          typeof a === 'object' &&
          typeof (a as AccentColor).id === 'string' &&
          typeof (a as AccentColor).name === 'string' &&
          typeof (a as AccentColor).value === 'string' &&
          HEX.test((a as AccentColor).value)
      )
      .slice(0, 24)
      .map((a) => ({ ...a, custom: true, id: a.id.slice(0, 64), name: a.name.slice(0, 40) }));
  }
  if (Array.isArray(src.customGradients)) {
    out.customGradients = (src.customGradients as unknown[])
      .filter(
        (g): g is GradientDef =>
          !!g &&
          typeof g === 'object' &&
          typeof (g as GradientDef).id === 'string' &&
          Array.isArray((g as GradientDef).colors) &&
          (g as GradientDef).colors.length >= 2 &&
          (g as GradientDef).colors.length <= 3 &&
          (g as GradientDef).colors.every((c) => typeof c === 'string' && HEX.test(c))
      )
      .slice(0, 24)
      .map((g) => ({
        ...g,
        custom: true,
        id: g.id.slice(0, 64),
        name: String(g.name ?? 'Свой градиент').slice(0, 40),
        angle: isNum(g.angle) ? Math.min(360, Math.max(0, g.angle)) : 135
      }));
  }

  const bg = src.background as Record<string, unknown> | undefined;
  if (bg && typeof bg === 'object') {
    out.background = {
      kind: KINDS.includes(String(bg.kind)) ? (bg.kind as AppearanceSettings['background']['kind']) : base.background.kind,
      color: typeof bg.color === 'string' && HEX.test(bg.color) ? bg.color : base.background.color,
      gradientId: typeof bg.gradientId === 'string' ? bg.gradientId.slice(0, 64) : base.background.gradientId,
      animatedId: ANIMATED.includes(String(bg.animatedId)) ? String(bg.animatedId) : base.background.animatedId,
      intensity: isNum(bg.intensity) ? Math.min(1, Math.max(0, bg.intensity)) : base.background.intensity
    };
  }

  if (src.layout && typeof src.layout === 'object') {
    const layout: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(src.layout as Record<string, unknown>)) {
      if (!/^[a-z]{2,24}$/.test(k)) continue;
      if (!Array.isArray(v)) continue;
      layout[k] = v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,32}$/.test(x)).slice(0, 40);
    }
    out.layout = layout;
  }

  // Кастомная тема переносится как есть: основа, акцент и фон уже проверены выше
  out.custom = src.custom === true;
  out.customTheme = out.custom ? { base: out.theme, accentId: out.accentId, background: out.background } : base.customTheme ?? null;

  if (warnings.length) {
    return { ok: true, appearance: out, error: `Некоторые поля заменены значениями по умолчанию: ${warnings.join(', ')}` };
  }
  return { ok: true, appearance: out };
}