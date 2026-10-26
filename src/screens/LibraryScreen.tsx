import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Loader2, Package, Play, Plus, Star, Clock3, Sparkles } from 'lucide-react';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Tabs, Toggle } from '../ui/Controls';
import { SearchField, Select } from '../ui/TextField';
import { EmptyState, ScreenHeader } from '../ui/Common';
import { CreateInstanceModal } from './library/CreateInstanceModal';
import { ImportMinecraftModal } from './library/ImportMinecraftModal';
import { InstancePage } from './library/InstancePage';
import { useToast } from '../state/toast';
import { useSettings } from '../state/settings';
import { fmtPlaytime } from '../i18n';
import type { Instance, LoaderKind } from '../../shared/types';

type Filter = 'all' | 'modpacks' | 'favorites';

interface VersionOption {
  id: string;
  type: string;
  releaseTime: string;
}

const LOADERS: { id: LoaderKind; label: string }[] = [
  { id: 'vanilla', label: 'Без загрузчика' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'forge', label: 'Forge' },
  { id: 'quilt', label: 'Quilt' }
];

export function LibraryScreen() {
  const { settings } = useSettings();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [importingMc, setImportingMc] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [presetVersion, setPresetVersion] = useState<string | undefined>();

  // Быстрое создание: версия игры + загрузчик, без отдельного окна.
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [gameVersion, setGameVersion] = useState('');
  const [kind, setKind] = useState<LoaderKind>('fabric');
  const [snapshots, setSnapshots] = useState(false);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [keybindCount, setKeybindCount] = useState(0);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    const list = await api.invoke<Instance[]>('instances:list');
    setInstances(list);
    setLoading(false);
    return list;
  }, []);

  useEffect(() => {
    setSnapshots(!!settings?.general.showSnapshots);
  }, [settings?.general.showSnapshots]);

  useEffect(() => {
    void api
      .invoke<{ versions: VersionOption[]; latest?: { release: string } }>('versions:list', snapshots)
      .then((res) => {
        setVersions(res.versions);
        setGameVersion((prev) => (prev && res.versions.some((v) => v.id === prev) ? prev : res.latest?.release ?? res.versions[0]?.id ?? ''));
      })
      .catch(() => setVersions([]));
  }, [snapshots]);

  useEffect(() => {
    if (!gameVersion || kind === 'vanilla') {
      setLoaderVersions([]);
      setLoaderVersion('');
      return;
    }
    let alive = true;
    setLoaderVersion('');
    void api
      .invoke<{ versions: string[]; error?: string }>('versions:loaders', gameVersion, kind)
      .then((res) => {
        if (!alive) return;
        setLoaderVersions(res.versions);
        setLoaderVersion(res.versions[0] ?? '');
        if (res.error) toast('warning', 'Не удалось получить версии загрузчика', res.error);
      })
      .catch(() => alive && setLoaderVersions([]));
    return () => {
      alive = false;
    };
  }, [gameVersion, kind, toast]);

  useEffect(() => {
    if (!gameVersion) return;
    void api
      .invoke<{ count: number }>('instances:keybindsFor', gameVersion)
      .then((res) => setKeybindCount(res.count))
      .catch(() => setKeybindCount(0));
  }, [gameVersion, settings?.controls]);

  useEffect(() => {
    void reload().then((list) => {
      const hash = window.location.hash;
      if (/[?&]create=/.test(hash)) {
        const preset = hash.match(/[?&]version=([^&]+)/);
        const version = preset ? decodeURIComponent(preset[1]) : undefined;
        setPresetVersion(version);
        if (version) setGameVersion(version);
        setCreating(true);
        window.location.hash = '/library';
      }
      const match = hash.match(/instance=([^&]+)/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        setSelected(id);
        if (list.some((i) => i.id === id)) setOpenId(id);
      }
      // Ни одна сборка не выбирается автоматически: экран открывается
      // с выбором версии и загрузчика для новой сборки.
    });
  }, [reload]);

  const createQuick = async () => {
    if (!gameVersion || busy) return;
    setBusy(true);
    setStep('Создание папки сборки…');
    try {
      const label = LOADERS.find((l) => l.id === kind)?.label ?? kind;
      const instance = await api.invoke<Instance>('instances:create', {
        name: kind === 'vanilla' ? `Minecraft ${gameVersion}` : `${label} ${gameVersion}`,
        gameVersion,
        loader: kind === 'vanilla' ? { kind } : { kind, version: loaderVersion || undefined },
        memoryMb: settings?.general.memoryMb
      });
      toast('success', 'Сборка создана', `${instance.name} · загрузчик установится при первом запуске`);
      await reload();
      setSelected(instance.id);
      setOpenId(instance.id);
      window.location.hash = `/library?instance=${instance.id}`;
    } catch (e) {
      toast('error', 'Не удалось создать сборку', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  const shown = useMemo(() => {
    let list = instances;
    if (filter === 'favorites') list = list.filter((i) => i.favorite);
    if (filter === 'modpacks') list = list.filter((i) => i.source?.kind === 'modrinth' || i.source?.kind === 'curseforge');
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || i.gameVersion.includes(q));
    }
    return list;
  }, [instances, filter, query]);

  const opened = instances.find((i) => i.id === openId) ?? null;

  const versionOptions = useMemo(
    () =>
      versions.slice(0, 200).map((v) => ({
        value: v.id,
        label: v.id,
        hint: v.type === 'release' ? undefined : v.type
      })),
    [versions]
  );

  const loaderLabel = LOADERS.find((l) => l.id === kind)?.label ?? kind;

  const play = async (instance: Instance) => {
    try {
      await api.invoke('launch:start', instance.id);
    } catch (e) {
      toast('error', 'Не удалось запустить', e instanceof Error ? e.message : String(e));
    }
  };

  if (opened) {
    return (
      <InstancePage
        instance={opened}
        onBack={() => {
          setOpenId(null);
          window.location.hash = '/library';
        }}
        onChanged={() => void reload()}
        onDeleted={() => {
          setOpenId(null);
          setSelected(null);
          window.location.hash = '/library';
          void reload();
        }}
      />
    );
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Сборки"
        sub="Каждая сборка — отдельная папка со своими модами, конфигами и мирами."
        actions={
          <>
            <Button variant="secondary" icon={<FolderPlus size={16} />} onClick={() => setImportingMc(true)}>
              Из .minecraft
            </Button>
            <Button
              variant="secondary"
              icon={<FolderPlus size={16} />}
              onClick={() => (window.location.hash = '/import')}
            >
              Импорт
            </Button>
          </>
        }
      />

      <section className="panel library-create">
        <div className="library-create__head">
          <span className="library-create__icon">
            <Sparkles size={18} />
          </span>
          <div className="col grow" style={{ gap: 1 }}>
            <span style={{ fontWeight: 650 }}>Новая сборка</span>
            <span className="tiny muted">
              Выберите версию игры и загрузчик — папка создастся сама. Название можно поменять на странице сборки.
            </span>
          </div>
        </div>
        <div className="library-create__grid">
          <div className="field">
            <span className="field__label">Версия Minecraft</span>
            <Select
              value={gameVersion}
              options={versionOptions}
              onChange={setGameVersion}
              placeholder={versions.length ? 'Выберите версию' : 'Загрузка списка…'}
              disabled={busy}
            />
            <div className="library-create__snap-row">
              <Toggle
                checked={snapshots}
                onChange={setSnapshots}
                disabled={busy}
                label="Показывать снапшоты и старые версии"
              />
              <button
                type="button"
                className="library-create__snap-label"
                onClick={() => setSnapshots(!snapshots)}
                disabled={busy}
              >
                Показывать снапшоты и старые версии
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field__label">Загрузчик модов</span>
            <div className="loader-pills">
              {LOADERS.map((l) => (
                <button
                  key={l.id}
                  className="chip chip--button"
                  data-active={kind === l.id ? 'true' : undefined}
                  disabled={busy}
                  onClick={() => setKind(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">{kind === 'vanilla' ? 'Чистая игра' : `Версия ${loaderLabel}`}</span>
            {kind === 'vanilla' ? (
              <span className="field__hint" style={{ marginTop: 6 }}>
                Ресурспаки работают, моды и шейдеры — нет.
              </span>
            ) : (
              <Select
                value={loaderVersion}
                options={loaderVersions.map((v) => ({ value: v, label: v }))}
                onChange={setLoaderVersion}
                placeholder={loaderVersions.length ? 'Последняя версия' : 'Загрузка списка…'}
                disabled={!loaderVersions.length || busy}
              />
            )}
          </div>
          <div className="library-create__actions">
            <Button onClick={createQuick} loading={busy} disabled={!gameVersion} icon={<Plus size={16} />}>
              Создать сборку
            </Button>
            <Button variant="secondary" onClick={() => setCreating(true)} disabled={busy} data-tour="library-more">
              Больше параметров
            </Button>
          </div>
        </div>
        <div className="tiny muted row" style={{ gap: 6, marginTop: 10 }}>
          {busy ? (
            <>
              <Loader2 size={13} className="spin" /> {step}
            </>
          ) : keybindCount > 0 ? (
            <>К новой сборке применятся {keybindCount} клавиш из «Настройки управления».</>
          ) : (
            <>Управление из «Настройки управления» применится к новой сборке автоматически.</>
          )}
        </div>
      </section>

      <div className="library">
        <div className="library__main">
          <div className="library__toolbar">
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                { id: 'all', label: 'Все' },
                { id: 'modpacks', label: 'Модпаки' },
                { id: 'favorites', label: 'Избранное' }
              ]}
            />
            <div className="library__search">
              <SearchField value={query} onChange={setQuery} placeholder="Поиск сборок…" />
            </div>
          </div>

          {loading ? (
            <div className="library__grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 210 }} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<Package size={26} />}
                title={instances.length ? 'Ничего не найдено' : 'Сборок пока нет'}
                hint={
                  instances.length
                    ? 'Попробуйте другой фильтр или запрос.'
                    : 'Выберите версию и загрузчик в блоке «Новая сборка» выше — папка сборки создастся сразу.'
                }
                action={
                  <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                    Больше параметров
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="library__grid">
              {shown.map((inst, idx) => (
                <article
                  key={inst.id}
                  className="card card--hover instance-card rise-in"
                  style={{ ['--i' as string]: idx }}
                  aria-selected={inst.id === selected}
                  onClick={() => {
                    setSelected(inst.id);
                    setOpenId(inst.id);
                    window.location.hash = `/library?instance=${inst.id}`;
                  }}
                >
                  <div
                    className="instance-card__cover"
                    style={
                      inst.coverDataUrl
                        ? {
                            backgroundImage: `url(${inst.coverDataUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center'
                          }
                        : {
                            ['--cover-a' as string]: `hsl(${inst.iconHue} 30% 52%)`,
                            ['--cover-b' as string]: `hsl(${(inst.iconHue + 45) % 360} 30% 74%)`
                          }
                    }
                  >
                    {!inst.coverDataUrl && (
                      <span className="instance-card__initial">{inst.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="instance-card__badge">
                      {inst.loader.kind === 'vanilla' ? 'без загрузчика' : inst.loader.kind}
                    </span>
                    <button
                      className="instance-card__fav"
                      data-on={inst.favorite ? 'true' : undefined}
                      aria-label="В избранное"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await api.invoke('instances:update', inst.id, { favorite: !inst.favorite });
                        void reload();
                      }}
                    >
                      <Star size={14} fill={inst.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="instance-card__name truncate" data-i18n-skip>{inst.name}</div>
                  <div className="instance-card__meta">
                    <span>{inst.gameVersion}</span>
                    {inst.loader.version && <span>· {inst.loader.version}</span>}
                  </div>
                  <div className="instance-card__foot">
                    <button
                      className="instance-card__play"
                      aria-label="Играть"
                      onClick={(e) => {
                        e.stopPropagation();
                        void play(inst);
                      }}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                    <div className="instance-card__bar">
                      <span className="tiny muted row" style={{ gap: 4, marginLeft: 'auto' }}>
                        <Clock3 size={11} /> {fmtPlaytime(inst.playtimeMinutes)}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

      </div>

      <CreateInstanceModal
        open={creating}
        presetVersion={presetVersion}
        onClose={() => {
          setCreating(false);
          setPresetVersion(undefined);
        }}
        onCreated={(inst) => {
          setSelected(inst.id);
          setOpenId(inst.id);
          void reload();
        }}
      />
      <ImportMinecraftModal
        open={importingMc}
        onClose={() => setImportingMc(false)}
        onImported={(inst) => {
          setSelected(inst.id);
          void reload();
        }}
      />
    </div>
  );
}
