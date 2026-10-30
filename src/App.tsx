import React, { useEffect, useState } from 'react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Gamepad2,
  Home,
  Keyboard,
  Layers,
  Minimize2,
  Minus,
  Settings as SettingsIcon,
  Shirt,
  Square,
  Terminal,
  UserRound,
  X
} from 'lucide-react';
import { useSettings } from './state/settings';
import { api } from './api';
import { BackgroundLayer } from './ui/BackgroundLayer';
import { DownloadsIndicator } from './ui/DownloadsIndicator';
import { AccountModal } from './ui/AccountModal';
import { CrashDialog } from './ui/CrashDialog';
import { Onboarding } from './ui/Onboarding';
import { useToast } from './state/toast';
import { applyAppearance, useSystemDark, useWindowFocused } from './theme/apply';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { ModsScreen } from './screens/ModsScreen';
import { SkinsScreen } from './screens/SkinsScreen';
import { WorldsScreen } from './screens/WorldsScreen';
import { AssistantScreen } from './screens/AssistantScreen';
import { ImportScreen } from './screens/ImportScreen';
import { ConsoleScreen } from './screens/ConsoleScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { ControlsScreen } from './screens/ControlsScreen';
import type { Account } from '../shared/types';

export type ScreenId = 'home' | 'library' | 'mods' | 'skins' | 'worlds' | 'assistant' | 'console' | 'settings' | 'gallery' | 'import' | 'controls';

const NAV: { id: ScreenId; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string }[] = [
  { id: 'home', icon: Home, label: 'Главная' },
  { id: 'library', icon: FolderOpen, label: 'Сборки' },
  { id: 'mods', icon: Layers, label: 'Библиотека' },
  { id: 'skins', icon: Shirt, label: 'Скины' },
  { id: 'assistant', icon: Bot, label: 'Помощник' },
  { id: 'console', icon: Terminal, label: 'Консоль' },
  { id: 'settings', icon: SettingsIcon, label: 'Настройки' },
  { id: 'controls', icon: Keyboard, label: 'Настройки управления' }
];

const SCREENS: Record<ScreenId, React.ComponentType> = {
  home: HomeScreen,
  library: LibraryScreen,
  mods: ModsScreen,
  skins: SkinsScreen,
  worlds: WorldsScreen,
  assistant: AssistantScreen,
  console: ConsoleScreen,
  settings: SettingsScreen,
  gallery: GalleryScreen,
  import: ImportScreen,
  controls: ControlsScreen
};

function readRoute(): ScreenId {
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0];
  if (hash === 'gallery') return 'gallery';
  if (hash === 'import') return 'import';
  return (NAV.find((n) => n.id === hash)?.id ?? 'home') as ScreenId;
}

export function App() {
  const { settings, info, ready } = useSettings();
  const [screen, setScreen] = useState<ScreenId>(readRoute);
  // Номер перехода из меню: экран пересоздаётся и открывается с начала
  // (закрываются гайд, страница проекта, внутренние вкладки и т. п.)
  const [navKey, setNavKey] = useState(0);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ploxel.sidebar') === 'mini');
  const [maximized, setMaximized] = useState(false);
  const [localSkin, setLocalSkin] = useState<string | null>(null);
  const [crashInstance, setCrashInstance] = useState<{ instanceId: string; code?: number | null } | null>(null);
  const systemDark = useSystemDark();
  const focused = useWindowFocused();
  const { toast } = useToast();

  useEffect(() => {
    const off = api.on('update:available', (payload) => {
      const payloadInfo = payload as { version: string };
      toast('info', `Доступно обновление Ploxel ${payloadInfo.version}`, 'Скачать можно в Настройки → О лаунчере.');
    });
    const offExit = api.on('game:exited', (payload) => {
      const p = payload as { crashed: boolean; instanceId: string; code?: number | null };
      if (p.crashed && p.instanceId) setCrashInstance({ instanceId: p.instanceId, code: p.code });
    });
    const offFail = api.on('launch:failed', (payload) => {
      const p = payload as { instanceId: string };
      if (p.instanceId) setCrashInstance({ instanceId: p.instanceId, code: null });
    });
    // Итог фоновой ИИ-сборки
    const offAssembled = api.on('ai:assembled', (payload) => {
      const r = payload as { name: string; installed: number; total: number; failed: string[]; removed: string[]; cancelled: boolean; improved?: boolean };
      const notes = [
        r.removed.length ? `Убрано из-за несовместимости: ${r.removed.join('; ')}` : '',
        r.failed.length ? `Не установилось: ${r.failed.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('; ');
      if (r.cancelled) toast('warning', `Сборка «${r.name}» остановлена`, `Установлено: ${r.installed} из ${r.total}`);
      else toast(r.failed.length ? 'warning' : 'success', r.improved ? `Сборка «${r.name}» улучшена` : `Сборка «${r.name}» готова`, notes || `Установлено: ${r.installed} из ${r.total}`);
    });
    return () => {
      off();
      offExit();
      offFail();
      offAssembled();
    };
  }, [toast]);

  useEffect(() => {
    const onHash = () => setScreen(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyAppearance(settings, systemDark);
  }, [settings, systemDark]);

  const loadAccount = () => {
    void api
      .invoke<Account | null>('accounts:active')
      .then(setAccount)
      .catch(() => setAccount(null));
    void api
      .invoke<{ current: string | null }>('skins:state')
      .then((s) => setLocalSkin(s.current))
      .catch(() => setLocalSkin(null));
  };

  useEffect(() => {
    if (settings) loadAccount();
  }, [settings]);

  useEffect(() => {
    const offSkins = api.on('skins:changed', () => loadAccount());
    const offAccounts = api.on('accounts:changed', () => loadAccount());
    const offMax = api.on('window:maximized', (v) => setMaximized(!!v));
    void api.invoke<boolean>('window:isMaximized').then(setMaximized);
    return () => {
      offSkins();
      offAccounts();
      offMax();
    };
  }, []);

  const toggleSidebar = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem('ploxel.sidebar', next ? 'mini' : 'full');
      return next;
    });
  };

  const go = (next: ScreenId) => {
    setScreen(next);
    setNavKey((n) => n + 1);
    window.location.hash = `/${next}`;
  };

  if (!ready || !settings || !info) {
    return (
      <div className="app">
        <BackgroundLayer settings={null} systemDark={systemDark} paused={false} />
        <div className="splash">
          <div className="splash__mark">
            <Gamepad2 size={28} />
          </div>
          <div className="splash__name">Ploxel</div>
        </div>
      </div>
    );
  }

  const Screen = SCREENS[screen];
  const isOnline = account?.type === 'microsoft' || account?.type === 'elyby';
  const faceSkin = account?.skinUrl ?? localSkin;

  return (
    <div className="app">
      <BackgroundLayer settings={settings} systemDark={systemDark} paused={!focused} />
      <div className="titlebar">
        {collapsed && <div className="titlebar__brand">Ploxel</div>}
        <div
          className="titlebar__drag"
          onDoubleClick={() => api.invoke<boolean>('window:maximize').then(setMaximized)}
        />
        <div className="window-controls">
          <button className="window-btn" onClick={() => api.app.minimize()} aria-label="Свернуть">
            <Minus size={14} />
          </button>
          <button
            className="window-btn"
            onClick={() => api.invoke<boolean>('window:maximize').then(setMaximized)}
            aria-label={maximized ? 'Восстановить' : 'Развернуть'}
          >
            {maximized ? <Minimize2 size={13} /> : <Square size={12} />}
          </button>
          <button className="window-btn window-btn--close" onClick={() => api.invoke('window:close')} aria-label="Закрыть">
            <X size={15} />
          </button>
        </div>
      </div>
      <div className={`shell ${collapsed ? 'shell--mini' : ''}`}>
        <aside className={`sidebar ${collapsed ? 'sidebar--mini' : ''}`}>
          <div className="brand" title="Ploxel">
            <span className="brand__mark">
              <Gamepad2 size={18} />
            </span>
            {!collapsed && <span className="brand__text">Ploxel</span>}
          </div>
          <nav className="nav">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = item.id === screen;
              return (
                <button
                  key={item.id}
                  className={item.label.length > 12 ? 'nav-item nav-item--wrap' : 'nav-item'}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                  data-tour={`nav-${item.id}`}
                  onClick={() => go(item.id)}
                >
                  <Icon size={20} strokeWidth={1.8} />
                  {!collapsed && <span className="nav-item__label">{item.label}</span>}
                </button>
              );
            })}
          </nav>
          <DownloadsIndicator />
          <button
            className="profile-card"
            onClick={() => setAccountOpen(true)}
            title={account ? account.name : 'Войти в аккаунт'}
            data-tour="account"
          >
            <span className="avatar" aria-hidden>
              {faceSkin ? (
                <>
                  <span
                    className="avatar__face"
                    style={{
                      backgroundImage: `url(${faceSkin})`,
                      backgroundSize: '800% 800%',
                      backgroundPosition: '14.28% 14.28%'
                    }}
                  />
                  <span
                    className="avatar__face avatar__face--hat"
                    style={{
                      backgroundImage: `url(${faceSkin})`,
                      backgroundSize: '800% 800%',
                      backgroundPosition: '71.42% 14.28%'
                    }}
                  />
                </>
              ) : account ? (
                <span style={{ fontWeight: 700 }}>{account.name.slice(0, 1).toUpperCase()}</span>
              ) : (
                <UserRound size={18} />
              )}
            </span>
            {!collapsed && (
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <span className="profile-card__name">{account ? account.name : 'Войти в аккаунт'}</span>
                <span className="profile-card__status">
                  <span className="status-dot" data-online={isOnline} />
                  {account ? (isOnline ? 'В сети' : 'Офлайн') : 'Офлайн'}
                </span>
              </span>
            )}
          </button>
          <button
            className="sidebar__collapse"
            onClick={toggleSidebar}
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </aside>
        <main className="content">
          <div className="content__scroll" key={`${screen}-${navKey}`}>
            <Screen />
          </div>
        </main>
      </div>
      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} onChanged={loadAccount} />
      <CrashDialog
        instanceId={crashInstance?.instanceId ?? null}
        exitCode={crashInstance?.code ?? null}
        onClose={() => setCrashInstance(null)}
      />
      <Onboarding />
    </div>
  );
}