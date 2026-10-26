import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { api } from '../api';
import { accentById, contrastRatio, contrastText, fontById, gradientById, hexToRgb, themeById } from '../theme/presets';
import { resolveDark } from '../../shared/theme';

/** Применяет тему, акцент, фон, шрифт, масштаб и уровень анимаций к документу. */
export function applyAppearance(settings: Settings, systemDark: boolean) {
  const a = settings.appearance;
  const root = document.documentElement;
  const theme = themeById(a.theme).id;
  const dark = resolveDark(a.colorMode, systemDark);

  root.dataset.theme = theme;
  root.dataset.mode = dark ? 'dark' : 'light';
  root.dataset.motion = a.motion;
  root.lang = settings.general.language;
  root.style.setProperty('--text-scale', String(a.textScale));
  root.style.setProperty('--radius-scale', String(a.radiusScale));
  root.style.setProperty('--panel-opacity', String(a.panelOpacity));

  const accent = accentById(a);
  root.style.setProperty('--accent', accent.value);
  root.style.setProperty('--accent-text', contrastText(accent.value));

  const font = fontById(a.fontId);
  root.style.setProperty('--font-ui', font.stack);
  root.style.setProperty('--font-display', font.kind === 'serif' ? font.stack : "'Lora', Georgia, serif");

  // Градиент фона выбирается в «Фоне приложения» (background.gradientId)
  const g = gradientById({ gradientId: a.background.gradientId || a.gradientId, customGradients: a.customGradients });
  root.style.setProperty('--bg-solid', a.background.color);
  root.style.setProperty('--bg-1', g.colors[0]);
  root.style.setProperty('--bg-2', g.colors[1]);
  root.style.setProperty('--bg-3', g.colors[2] ?? g.colors[1]);
  root.style.setProperty('--bg-angle', `${g.angle}deg`);

  // Текст вне панелей должен читаться при любом фоне: считаем контраст
  // между фоном и текстом темы и при необходимости инвертируем.
  const bgSample = sampleBackground(a, dark);
  const textColor = getComputedStyle(root).getPropertyValue('--text').trim() || '#26241F';
  const ratio = contrastRatio(bgSample, textColor);
  if (ratio < 4.5) {
    const onBg = contrastRatio(bgSample, '#FFFDF8') >= contrastRatio(bgSample, '#1F1C17') ? '#FFFDF8' : '#1F1C17';
    root.style.setProperty('--on-bg', onBg);
    root.style.setProperty('--on-bg-muted', `color-mix(in srgb, ${onBg} 72%, transparent)`);
    root.dataset.bgContrast = 'forced';
  } else {
    root.style.removeProperty('--on-bg');
    root.style.removeProperty('--on-bg-muted');
    delete root.dataset.bgContrast;
  }

  // Панели полупрозрачные: над «чужим» фоном текст может потерять контраст.
  // Поднимаем прозрачность до минимальной, при которой текст читается.
  const panelRgb = getComputedStyle(root).getPropertyValue('--panel-rgb').trim();
  if (panelRgb) {
    const panelHex = rgbTripletToHex(panelRgb);
    let alpha = a.panelOpacity;
    while (alpha < 1) {
      const blended = blendHex(panelHex, bgSample, alpha);
      if (contrastRatio(blended, textColor) >= 4.5) break;
      alpha = Math.min(1, alpha + 0.05);
    }
    root.style.setProperty('--panel-opacity', alpha.toFixed(2));
  }

  void api.app.chrome(theme, dark);
}

function rgbTripletToHex(triplet: string): string {
  const parts = triplet.split(/[^\d]+/).filter(Boolean).slice(0, 3).map(Number);
  if (parts.length < 3) return '#FFFFFF';
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

/** Наложение панели (panel) на фон (bg) с прозрачностью alpha. */
function blendHex(panel: string, bg: string, alpha: number): string {
  return mixHex(bg, panel, alpha);
}

/** Цвет фона для проверки контраста текста вне панелей. */
function sampleBackground(a: Settings['appearance'], dark: boolean): string {
  const bg = a.background;
  if (bg.kind === 'solid') return bg.color;
  if (bg.kind === 'gradient') {
    const g = gradientById({ gradientId: bg.gradientId || a.gradientId, customGradients: a.customGradients });
    const [r1, g1, b1] = hexToRgb(g.colors[0]);
    const [r2, g2, b2] = hexToRgb(g.colors[1]);
    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${toHex((r1 + r2) / 2)}${toHex((g1 + g2) / 2)}${toHex((b1 + b2) / 2)}`;
  }
  const t = themeById(a.theme);
  const base = (dark ? t.dark : t.light)[0];
  // Анимированный фон строится на цвете темы и акценте
  if (bg.kind === 'animated') return mixHex(base, accentById(a).value, 0.25);
  return base;
}

function mixHex(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** true, если окно не в фокусе или пользователь свернул его — анимации на паузе. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
}