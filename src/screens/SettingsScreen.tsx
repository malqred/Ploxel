import { useEffect, useState } from 'react';
import { Bot, Download, GraduationCap, Info, Languages, Palette, SlidersHorizontal, UserRound, Coffee } from 'lucide-react';
import { ScreenHeader } from '../ui/Common';
import { GeneralTab } from './settings/GeneralTab';
import { AccountsTab } from './settings/AccountsTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { JavaTab } from './settings/JavaTab';
import { AiTab } from './settings/AiTab';
import { AboutTab } from './settings/AboutTab';
import { LanguageTab } from './settings/LanguageTab';
import { OnboardingTab } from './settings/OnboardingTab';
import { DownloadsTab } from './settings/DownloadsTab';

type TabId = 'general' | 'accounts' | 'appearance' | 'language' | 'java' | 'ai' | 'downloads' | 'onboarding' | 'about';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'general', label: 'Общие', icon: SlidersHorizontal },
  { id: 'accounts', label: 'Аккаунты', icon: UserRound },
  { id: 'appearance', label: 'Внешний вид', icon: Palette },
  { id: 'language', label: 'Язык', icon: Languages },
  { id: 'java', label: 'Java и память', icon: Coffee },
  { id: 'ai', label: 'ИИ-помощник', icon: Bot },
  { id: 'downloads', label: 'Загрузки', icon: Download },
  { id: 'onboarding', label: 'Обучение', icon: GraduationCap },
  { id: 'about', label: 'О лаунчере', icon: Info }
];

function readTab(): TabId {
  const hash = window.location.hash;
  const m = hash.match(/[?&]tab=([a-z]+)/);
  return (TABS.find((t) => t.id === m?.[1])?.id ?? 'general') as TabId;
}

export function SettingsScreen() {
  const [tab, setTab] = useState<TabId>(readTab);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id: TabId) => {
    setTab(id);
    window.location.hash = `/settings?tab=${id}`;
  };

  return (
    <div className="screen settings">
      <ScreenHeader title="Настройки" sub="Изменения применяются сразу и сохраняются локально." />
      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className="settings-nav__item"
                aria-current={tab === t.id ? 'true' : undefined}
                onClick={() => go(t.id)}
              >
                <Icon size={17} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="settings-body">
          {tab === 'general' && <GeneralTab />}
          {tab === 'accounts' && <AccountsTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'language' && <LanguageTab />}
          {tab === 'java' && <JavaTab />}
          {tab === 'ai' && <AiTab />}
          {tab === 'downloads' && <DownloadsTab />}
          {tab === 'onboarding' && <OnboardingTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}