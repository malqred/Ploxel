import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Gamepad2, Play, Plus } from 'lucide-react';
import { api } from '../api';
import { fmtRelative } from '../i18n';
import { Button } from '../ui/Button';
import { Select } from '../ui/TextField';
import { ScreenHeader } from '../ui/Common';
import { LauncherSearch } from './home/LauncherSearch';
import { GuideView } from './home/GuideView';
import { useToast } from '../state/toast';
import { AccountModal } from '../ui/AccountModal';
import { MinecraftNews } from './home/MinecraftNews';
import { WeeklyPlaytime } from './home/WeeklyPlaytime';
import type { Guide } from '../content/guides';
import type { Account, Instance } from '../../shared/types';

export function HomeScreen() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [launchId, setLaunchId] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const { toast } = useToast();

  const loadAccount = () => {
    void api.invoke<Account | null>('accounts:active').then(setAccount).catch(() => setAccount(null));
  };

  useEffect(() => {
    void api.invoke<Instance[]>('instances:list').then((list) => {
      setInstances(list);
      setLaunchId((cur) => cur || list[0]?.id || '');
    });
    loadAccount();
    const off = api.on('game:started', () => void api.invoke<Instance[]>('instances:list').then(setInstances));
    const offAcc = api.on('accounts:changed', loadAccount);
    return () => {
      off();
      offAcc();
    };
  }, []);

  const launchInstance = instances.find((i) => i.id === launchId) ?? null;
  const recent = useMemo(
    () =>
      [...instances]
        .sort((a, b) => (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt))
        .slice(0, 4),
    [instances]
  );
  const favorites = useMemo(() => instances.filter((i) => i.favorite).slice(0, 3), [instances]);

  const launch = async (inst: Instance | null) => {
    if (!inst) {
      toast('warning', 'Сначала создайте сборку', 'Откройте «Сборки» и нажмите «Создать профиль».');
      return;
    }
    try {
      await api.invoke('launch:start', inst.id);
    } catch (e) {
      toast('error', 'Не удалось запустить', e instanceof Error ? e.message : String(e));
    }
  };

  if (guide) {
    return <GuideView guide={guide} onBack={() => setGuide(null)} onOpen={setGuide} />;
  }

  return (
    <div className="screen">
      <ScreenHeader title="Главная" sub="Поиск по лаунчеру, недавние сборки и подробные гайды." />

      <div className="home">
        <div className="home__main">
          <LauncherSearch instances={instances} onOpenGuide={setGuide} />

          <section className="col">
            <div className="section-head">
              <h2 className="section-title">Недавние сборки</h2>
              <Button variant="ghost" size="sm" onClick={() => (window.location.hash = '/library')}>
                Все сборки <ChevronRight size={14} />
              </Button>
            </div>
            {recent.length === 0 ? (
              <div className="panel">
                <div className="row" style={{ gap: 14 }}>
                  <span
                    className="recent-card__icon"
                    style={{ ['--icon-a' as string]: '#7E9C89', ['--icon-b' as string]: '#BFCDB0' }}
                  >
                    <Gamepad2 size={22} />
                  </span>
                  <div className="col grow" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 650 }}>Сборок пока нет</span>
                    <span className="small muted">Создайте первую: выберите версию и загрузчик модов.</span>
                  </div>
                  <Button icon={<Plus size={16} />} onClick={() => (window.location.hash = '/library')}>
                    Создать сборку
                  </Button>
                </div>
              </div>
            ) : (
              <div className="recent-grid">
                {recent.map((inst, idx) => (
                  <button
                    key={inst.id}
                    className="recent-tile card card--hover rise-in"
                    style={{ ['--i' as string]: idx }}
                    onClick={() => (window.location.hash = `/library?instance=${inst.id}`)}
                  >
                    <span
                      className="recent-tile__cover"
                      style={
                        inst.coverDataUrl
                          ? { backgroundImage: `url(${inst.coverDataUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                          : {
                              ['--cover-a' as string]: `hsl(${inst.iconHue} 30% 52%)`,
                              ['--cover-b' as string]: `hsl(${(inst.iconHue + 45) % 360} 30% 74%)`
                            }
                      }
                    >
                      {!inst.coverDataUrl && (
                        <span className="recent-tile__initial">{inst.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="col" style={{ gap: 1, minWidth: 0 }}>
                      <span className="truncate" style={{ fontWeight: 650 }} data-i18n-skip>{inst.name}</span>
                      <span className="tiny muted">
                        {inst.gameVersion} · {inst.loader.kind === 'vanilla' ? 'без загрузчика' : inst.loader.kind}
                        {inst.lastPlayedAt ? ` · ${fmtRelative(inst.lastPlayedAt)}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <MinecraftNews instances={instances} />
        </div>

        <aside className="home__aside">

          <WeeklyPlaytime />

          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Избранные сборки</h2>
              <span className="chip">{favorites.length}</span>
            </div>
            {favorites.length === 0 ? (
              <p className="small muted">Отметьте сборку звездой — она появится здесь.</p>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {favorites.map((f) => (
                  <button
                    className="action-row"
                    key={f.id}
                    onClick={() => (window.location.hash = `/library?instance=${f.id}`)}
                  >
                    <span className="status-dot" style={{ background: `hsl(${f.iconHue} 35% 55%)`, width: 10, height: 10 }} />
                    <span className="grow truncate">{f.name}</span>
                    <span className="tiny muted">{f.gameVersion}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel launch-card" data-tour="launch">
            <div
              className="launch-card__cover"
              style={
                launchInstance?.coverDataUrl
                  ? { backgroundImage: `url(${launchInstance.coverDataUrl})` }
                  : {
                      ['--cover-a' as string]: `hsl(${launchInstance?.iconHue ?? 140} 30% 46%)`,
                      ['--cover-b' as string]: `hsl(${((launchInstance?.iconHue ?? 140) + 45) % 360} 30% 70%)`
                    }
              }
            >
              <span className="launch-card__label">Быстрый запуск</span>
              {launchInstance && (
                <span className="launch-card__name">
                  <span className="truncate" data-i18n-skip>{launchInstance.name}</span>
                  <span className="launch-card__sub">
                    {launchInstance.loader.kind === 'vanilla' ? 'без загрузчика' : launchInstance.loader.kind}, {launchInstance.gameVersion}
                  </span>
                </span>
              )}
            </div>
            {instances.length === 0 ? (
              <span className="small muted">Сборок нет — создайте первую.</span>
            ) : (
              <Select
                value={launchId}
                options={instances.map((i) => ({ value: i.id, label: i.name, hint: i.gameVersion }))}
                onChange={setLaunchId}
                width="100%"
                skipLabels
              />
            )}
            <Button
              size="lg"
              glow
              block
              icon={<Play size={18} fill="currentColor" />}
              onClick={() => launch(launchInstance)}
              disabled={!launchInstance}
            >
              Играть
            </Button>
            <div className="launch-account">
              <span className="tiny muted">{`Аккаунт: ${account ? account.name : 'не выбран'}`}</span>
              <Button size="sm" variant="ghost" onClick={() => setAccountOpen(true)}>
                Сменить
              </Button>
            </div>
          </section>
        </aside>
      </div>
      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onChanged={loadAccount}
      />
    </div>
  );
}