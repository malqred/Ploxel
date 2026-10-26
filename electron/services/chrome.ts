import { BrowserWindow, nativeTheme } from 'electron';
import type { ThemeId } from '../../shared/types';
import { resolveDark } from '../../shared/theme';
import { loadSettings } from './settings';

/** Цвета верхней полосы окна под каждую тему (нативные кнопки Windows): [светлая, тёмная]. */
export const THEME_CHROME: Record<ThemeId, [{ color: string; symbolColor: string }, { color: string; symbolColor: string }]> = {
  cream: [{ color: '#EEE5D6', symbolColor: '#26241F' }, { color: '#181613', symbolColor: '#EFE7D9' }],
  sage: [{ color: '#E3EBDD', symbolColor: '#22301F' }, { color: '#131914', symbolColor: '#E6EFE1' }],
  fog: [{ color: '#E4EDF2', symbolColor: '#1F2A30' }, { color: '#11161A', symbolColor: '#E3ECF1' }],
  sunset: [{ color: '#F6E3D6', symbolColor: '#33221C' }, { color: '#1D1512', symbolColor: '#F5E7DC' }],
  sepia: [{ color: '#EBDFC9', symbolColor: '#33291D' }, { color: '#1A1610', symbolColor: '#F0E6D1' }],
  lavender: [{ color: '#E9E4F2', symbolColor: '#26213A' }, { color: '#16141E', symbolColor: '#ECE8F6' }],
  graphite: [{ color: '#E6E7E9', symbolColor: '#1F2124' }, { color: '#1A1C1F', symbolColor: '#EBE6DD' }]
};

export function applyWindowChrome(win: BrowserWindow, themeId?: ThemeId, dark?: boolean): void {
  const a = loadSettings().appearance;
  const theme = themeId ?? a.theme;
  const isDark = dark ?? resolveDark(a.colorMode, nativeTheme.shouldUseDarkColors);
  const chrome = (THEME_CHROME[theme] ?? THEME_CHROME.cream)[isDark ? 1 : 0];
  try {
    win.setTitleBarOverlay({ color: chrome.color, symbolColor: chrome.symbolColor, height: 40 });
    win.setBackgroundColor(chrome.color);
  } catch {
    /* старые версии Windows могут не поддерживать overlay — не критично */
  }
}
