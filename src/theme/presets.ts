import type { AccentColor, GradientDef, ThemeId } from '../../shared/types';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  /** фон, боковая панель, акцент — для светлого и тёмного режима */
  light: [string, string, string];
  dark: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: 'cream', name: 'Крем', light: ['#EEE5D6', '#1E1D1A', '#7E9C89'], dark: ['#181613', '#23201C', '#8FB39C'] },
  { id: 'sage', name: 'Шалфей', light: ['#E3EBDD', '#1F2A21', '#729A80'], dark: ['#131914', '#1C241E', '#86B094'] },
  { id: 'fog', name: 'Туман', light: ['#E4EDF2', '#1A2329', '#7E9EA8'], dark: ['#11161A', '#1A2126', '#8FB2BD'] },
  { id: 'sunset', name: 'Закат', light: ['#F6E3D6', '#2B1F1A', '#C98F6F'], dark: ['#1D1512', '#281E1A', '#D9A083'] },
  { id: 'sepia', name: 'Сепия', light: ['#EBDFC9', '#2B241A', '#8A9A6B'], dark: ['#1A1610', '#252018', '#A3B07F'] },
  { id: 'lavender', name: 'Лаванда', light: ['#E9E4F2', '#201C2B', '#9B86C4'], dark: ['#16141E', '#201D2B', '#B19FD6'] },
  { id: 'graphite', name: 'Графит', light: ['#E6E7E9', '#1C1E21', '#7F8C95'], dark: ['#1A1C1F', '#26292D', '#9DB7A5'] }
];

export function themeById(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export const ACCENTS: AccentColor[] = [
  { id: 'sage', name: 'Шалфей', value: '#7E9C89' },
  { id: 'lavender', name: 'Лаванда', value: '#9B86C4' },
  { id: 'ocean', name: 'Океан', value: '#6E9DB5' },
  { id: 'terracotta', name: 'Терракота', value: '#C4826A' },
  { id: 'amber', name: 'Янтарь', value: '#D9A441' },
  { id: 'rose', name: 'Роза', value: '#C77B8C' },
  { id: 'emerald', name: 'Изумруд', value: '#5FA37A' }
];

export const GRADIENTS: GradientDef[] = [
  { id: 'meadow', name: 'Луг', colors: ['#9DBFA6', '#D9D3B4'], angle: 135 },
  { id: 'dusk', name: 'Сумерки', colors: ['#B7A0D8', '#F0C9B0'], angle: 120 },
  { id: 'deep', name: 'Глубина', colors: ['#7FB3C8', '#2F5D73'], angle: 160 },
  { id: 'peach', name: 'Персик', colors: ['#F2C1A1', '#D98C7A'], angle: 140 },
  { id: 'forest', name: 'Лес', colors: ['#5C7F66', '#A9C4A2'], angle: 110 },
  { id: 'lilac', name: 'Сирень', colors: ['#C9B8E8', '#8E79B8'], angle: 150 },
  { id: 'sunrise', name: 'Рассвет', colors: ['#F5D77A', '#E48A6B', '#B45B72'], angle: 125 }
];

/** Акцент, который включается вместе с готовой темой. */
export const THEME_ACCENT: Record<ThemeId, string> = {
  cream: 'sage',
  sage: 'emerald',
  fog: 'ocean',
  sunset: 'terracotta',
  sepia: 'amber',
  lavender: 'lavender',
  graphite: 'ocean'
};

export interface FontDef {
  id: string;
  name: string;
  stack: string;
  kind: 'sans' | 'serif' | 'mono';
  file: string;
  license: string;
}

export const FONTS: FontDef[] = [
  { id: 'onest', name: 'Onest', stack: "'Onest', system-ui, sans-serif", kind: 'sans', file: 'onest.woff2', license: 'OFL-1.1' },
  { id: 'inter', name: 'Inter', stack: "'Inter', system-ui, sans-serif", kind: 'sans', file: 'inter.woff2', license: 'OFL-1.1' },
  { id: 'manrope', name: 'Manrope', stack: "'Manrope', system-ui, sans-serif", kind: 'sans', file: 'manrope.woff2', license: 'OFL-1.1' },
  { id: 'golos', name: 'Golos Text', stack: "'Golos Text', system-ui, sans-serif", kind: 'sans', file: 'golos.woff2', license: 'OFL-1.1' },
  { id: 'nunito', name: 'Nunito', stack: "'Nunito', system-ui, sans-serif", kind: 'sans', file: 'nunito.woff2', license: 'OFL-1.1' },
  { id: 'rubik', name: 'Rubik', stack: "'Rubik', system-ui, sans-serif", kind: 'sans', file: 'rubik.woff2', license: 'OFL-1.1' },
  { id: 'montserrat', name: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", kind: 'sans', file: 'montserrat.woff2', license: 'OFL-1.1' },
  { id: 'ptsans', name: 'PT Sans', stack: "'PT Sans', system-ui, sans-serif", kind: 'sans', file: 'ptsans.woff2', license: 'OFL-1.1' },
  { id: 'comfortaa', name: 'Comfortaa', stack: "'Comfortaa', system-ui, sans-serif", kind: 'sans', file: 'comfortaa.woff2', license: 'OFL-1.1' },
  { id: 'lora', name: 'Lora', stack: "'Lora', Georgia, serif", kind: 'serif', file: 'lora.woff2', license: 'OFL-1.1' },
  { id: 'ptserif', name: 'PT Serif', stack: "'PT Serif', Georgia, serif", kind: 'serif', file: 'ptserif.woff2', license: 'OFL-1.1' },
  { id: 'playfair', name: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", kind: 'serif', file: 'playfair.woff2', license: 'OFL-1.1' },
  { id: 'cormorant', name: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", kind: 'serif', file: 'cormorant.woff2', license: 'OFL-1.1' },
  { id: 'merriweather', name: 'Merriweather', stack: "'Merriweather', Georgia, serif", kind: 'serif', file: 'merriweather.woff2', license: 'OFL-1.1' },
  { id: 'jetbrains', name: 'JetBrains Mono', stack: "'JetBrains Mono', monospace", kind: 'mono', file: 'jetbrains.woff2', license: 'OFL-1.1' }
];

export function accentById(settings: { accentId: string; customAccents: AccentColor[] }): AccentColor {
  return (
    [...ACCENTS, ...settings.customAccents].find((a) => a.id === settings.accentId) ?? ACCENTS[0]
  );
}

export function gradientById(settings: { gradientId: string; customGradients: GradientDef[] }): GradientDef {
  return (
    [...GRADIENTS, ...settings.customGradients].find((g) => g.id === settings.gradientId) ?? GRADIENTS[0]
  );
}

export function fontById(id: string): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Контрастный цвет текста для кнопки с заданным фоном (WCAG).
 *  Выбираем не «по яркости», а по фактическому контрасту — иначе
 *  средние тона (например, шалфей) получают нечитаемый белый текст. */
export function contrastText(hex: string): string {
  const withWhite = contrastRatio(hex, '#FFFDF8');
  const withDark = contrastRatio(hex, '#1F1C17');
  return withWhite >= withDark ? '#FFFDF8' : '#1F1C17';
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}