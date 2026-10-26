import type { AppearanceSettings } from './types';

/**
 * Темы и режим света. Тема — это оттенок (7 штук), режим — светлый,
 * тёмный или как в Windows. Любая тема работает в обоих режимах.
 */

export const THEME_IDS = ['cream', 'sage', 'fog', 'sunset', 'sepia', 'lavender', 'graphite'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ColorMode = 'light' | 'dark' | 'system';
export const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

/**
 * Перевод настроек до 0.6.0: раньше светлые и тёмные темы были разными
 * темами («Полночь», «Графит» — тёмные), а «Следовать теме Windows»
 * переключал Крем ↔ Полночь. Вызывать до слияния с настройками по умолчанию.
 */
export function migrateAppearance<T extends Record<string, unknown>>(a: T): T {
  const out: Record<string, unknown> = { ...a };
  const theme = out.theme;
  if (!COLOR_MODES.includes(out.colorMode as ColorMode)) {
    out.colorMode = out.followSystemTheme
      ? 'system'
      : theme === 'midnight' || theme === 'graphite'
        ? 'dark'
        : 'light';
  }
  if (theme === 'midnight') out.theme = 'cream';
  else if (!isThemeId(theme)) out.theme = 'cream';
  out.followSystemTheme = out.colorMode === 'system';
  return out as T;
}

/** Итоговый режим с учётом системной темы. */
export function resolveDark(mode: ColorMode | undefined, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark);
}

/**
 * Правка акцента или фона превращает тему в «Кастомную»: основой остаётся
 * текущая тема, а снимок сохраняется, чтобы к нему можно было вернуться.
 * Явный выбор темы (patch.theme / patch.custom) — не правка.
 */
export function withCustomTheme(current: AppearanceSettings, patch: Partial<AppearanceSettings>): AppearanceSettings {
  const merged = { ...current, ...patch };
  const edits = 'accentId' in patch || 'background' in patch;
  if (!edits || 'theme' in patch || 'custom' in patch) return merged;
  return {
    ...merged,
    custom: true,
    customTheme: { base: merged.theme, accentId: merged.accentId, background: merged.background }
  };
}

