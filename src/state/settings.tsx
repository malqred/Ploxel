import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppInfo, AppearanceSettings, Settings } from '../../shared/types';
import { api } from '../api';
import { setLanguage } from '../i18n';
import { withCustomTheme } from '../../shared/theme';

interface SettingsContextValue {
  settings: Settings | null;
  info: AppInfo | null;
  ready: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
  updateAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  reset: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const LIGHT_THEMES = ['cream', 'sage', 'fog', 'sunset', 'sepia'];

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, i] = await Promise.all([api.settings.get(), api.app.info()]);
      if (!alive) return;
      setSettings(s);
      setInfo(i);
      setLanguage(s.general.language);
      maybeAutoMotion(s);
    })();
    const off = api.settings.onChange((s) => setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.settings.set(patch);
    setSettings(next);
  }, []);

  const updateAppearance = useCallback(
    async (patch: Partial<AppearanceSettings>) => {
      const current = await api.settings.get();
      const next = await api.settings.set({ appearance: withCustomTheme(current.appearance, patch) });
      setSettings(next);
    },
    []
  );

  const reset = useCallback(async () => {
    const next = await api.settings.reset();
    setSettings(next);
  }, []);

  const value = useMemo(
    () => ({ settings, info, ready: !!settings && !!info, update, updateAppearance, reset }),
    [settings, info, update, updateAppearance, reset]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings должен вызываться внутри SettingsProvider');
  return ctx;
}

/** Однократно: если в Windows отключены эффекты анимации — ставим «Выкл». */
function maybeAutoMotion(s: Settings) {
  try {
    if (localStorage.getItem('ploxel.motionAuto')) return;
    localStorage.setItem('ploxel.motionAuto', '1');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce && s.appearance.motion === 'full') {
      void api.settings.set({ appearance: { ...s.appearance, motion: 'off' } });
    }
  } catch {
    /* приватный режим — не критично */
  }
}

export function isDarkTheme(theme: string): boolean {
  return !LIGHT_THEMES.includes(theme);
}