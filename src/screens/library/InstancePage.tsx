import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wand2,
  ArrowLeft,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  Library,
  MonitorUp,
  Package,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Star,
  Trash2,
  Wrench
} from 'lucide-react';
import { api } from '../../api';
import { Button, IconButton } from '../../ui/Button';
import { Tabs, Toggle } from '../../ui/Controls';
import { ConfirmDialog, Modal } from '../../ui/Overlay';
import { SearchField, Select } from '../../ui/TextField';
import { EmptyState } from '../../ui/Common';
import { useToast } from '../../state/toast';
import { fmtPlaytime, fmtRelative } from '../../i18n';
import { CatalogBrowser, type ContentType } from '../mods/CatalogBrowser';
import { ProjectPage } from '../mods/ProjectPage';
import { BuildCheckModal } from './BuildCheckModal';
import { AiImproveModal } from './AiImproveModal';
import { InstanceSettingsModal } from './InstanceSettingsModal';
import { WorldsScreen } from '../WorldsScreen';
import type { CatalogProject, CatalogVersion, Instance, InstalledMod } from '../../../shared/types';

type Kind = 'mod' | 'resourcepack' | 'shader';
type Tab = Kind | 'worlds';
type Filter = 'all' | 'enabled' | 'disabled' | 'updates';

/** Категории модов Modrinth (у ресурспаков и шейдеров свои — для них фильтра нет). */
const MOD_CATEGORIES: { id: string; label: string }[] = [
  { id: 'adventure', label: 'Приключения' },
  { id: 'magic', label: 'Магия и фэнтези' },
  { id: 'optimization', label: 'Оптимизация' },
  { id: 'technology', label: 'Технологии' },
  { id: 'worldgen', label: 'Генерация мира' },
  { id: 'decoration', label: 'Украшения' },
  { id: 'equipment', label: 'Снаряжение' },
  { id: 'food', label: 'Еда' },
  { id: 'mobs', label: 'Мобы' },
  { id: 'storage', label: 'Хранение' },
  { id: 'transportation', label: 'Транспорт' },
  { id: 'utility', label: 'Утилиты' },
  { id: 'game-mechanics', label: 'Механики игры' },
  { id: 'management', label: 'Управление' },
  { id: 'social', label: 'Общение' },
  { id: 'economy', label: 'Экономика' },
  { id: 'minigame', label: 'Мини-игры' },
  { id: 'cursed', label: 'Необычное' },
  { id: 'library', label: 'Библиотеки' }
];

const KIND_TABS: { id: Kind; label: string; empty: string; ext: string[] }[] = [
  { id: 'mod', label: 'Моды', empty: 'Модов пока нет', ext: ['jar'] },
  { id: 'resourcepack', label: 'Ресурспаки', empty: 'Ресурспаков пока нет', ext: ['zip'] },
  { id: 'shader', label: 'Шейдеры', empty: 'Шейдеров пока нет', ext: ['zip'] }
];

const LOADER_NAME: Record<string, string> = {
  vanilla: 'Без загрузчика',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
};

/**
 * Страница сборки: шапка с обложкой и запуском, ниже — установленный
 * контент карточками (моды, ресурспаки, шейдеры) с включением, обновлением,
 * откатом и удалением прямо здесь.
 */
export function InstancePage({
  instance,
  onBack,
  onChanged,
  onDeleted
}: {
  instance: Instance;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [items, setItems] = useState<InstalledMod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('mod');
  const kind: Kind = tab === 'worlds' ? 'mod' : tab;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [aiOn, setAiOn] = useState(false);
  const [improveOpen, setImproveOpen] = useState(false);
  const [updates, setUpdates] = useState<Record<string, CatalogVersion>>({});
  const [checking, setChecking] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buildCheckOpen, setBuildCheckOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [project, setProject] = useState<{ project: CatalogProject; kind: ContentType } | null>(null);
  const [toRemove, setToRemove] = useState<InstalledMod | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [worlds, setWorlds] = useState(0);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    const list = await api.invoke<InstalledMod[]>('mods:list', instance.id);
    setItems(list);
    setLoaded(true);
    return list;
  }, [instance.id]);

  useEffect(() => {
    setLoaded(false);
    setUpdates({});
    void reload().then((list) => {
      // Файлы без источника пробуем узнать в каталогах (Modrinth, CurseForge) — появятся
      // иконки, названия и обновления
      if (list.some((m) => m.source === 'local')) {
        void api
          .invoke<number>('mods:identify', instance.id)
          .then((n) => (n > 0 ? reload() : undefined))
          .catch(() => undefined);
      }
    });
    void api.invoke<string[]>('launch:running').then((list) => setRunning(list.includes(instance.id)));
    const offStart = api.on('game:started', (p) => {
      if ((p as { instanceId: string }).instanceId === instance.id) setRunning(true);
    });
    const offEnd = api.on('game:exited', (p) => {
      if ((p as { instanceId: string }).instanceId === instance.id) setRunning(false);
    });
    // Фоновая установка (ИИ-сборка) добавила или убрала файлы
    const offMods = api.on('instance:modsChanged', (p) => {
      if ((p as { instanceId: string }).instanceId === instance.id) void reload();
    });
    return () => {
      offStart();
      offEnd();
      offMods();
    };
  }, [instance.id, reload]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { mod: 0, resourcepack: 0, shader: 0 };
    for (const m of items) if (m.kind in c) c[m.kind as Kind]++;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((m) => m.kind === kind)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q))
      .filter((m) => !category || (!!m.projectId && (categories[m.projectId] ?? []).includes(category)))
      .filter((m) =>
        filter === 'enabled' ? m.enabled : filter === 'disabled' ? !m.enabled : filter === 'updates' ? !!updates[m.id] : true
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, kind, query, filter, updates, category, categories]);

  useEffect(() => {
    void api.invoke<boolean>('ai:available').then(setAiOn).catch(() => setAiOn(false));
  }, []);

  // Категории Modrinth для установленных модов — пачкой, при изменении состава сборки
  const projectKey = items.map((m) => m.projectId ?? '').join(',');
  useEffect(() => {
    if (!projectKey.replace(/,/g, '')) return;
    void api
      .invoke<Record<string, string[]>>('mods:categories', instance.id)
      .then(setCategories)
      .catch(() => undefined);
  }, [instance.id, projectKey]);

  // Только категории, в которых есть моды этой сборки
  const categoryOptions = useMemo(() => {
    const present = new Set(items.filter((m) => m.kind === 'mod' && m.projectId).flatMap((m) => categories[m.projectId!] ?? []));
    return MOD_CATEGORIES.filter((c) => present.has(c.id));
  }, [items, categories]);

  const closeImprove = useCallback(() => setImproveOpen(false), []);
  const updateCount = Object.keys(updates).length;
  const kindUpdates = items.filter((m) => m.kind === kind && updates[m.id]);
  const kindTab = KIND_TABS.find((t) => t.id === kind)!;

  const play = async () => {
    if (running) {
      await api.invoke('launch:stop', instance.id);
      return;
    }
    setStarting(true);
    try {
      await api.invoke('launch:start', instance.id);
    } catch (e) {
      toast('error', 'Не удалось запустить', e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const toggle = async (mod: InstalledMod, enabled: boolean) => {
    setItems((list) => list.map((m) => (m.id === mod.id ? { ...m, enabled } : m)));
    try {
      await api.invoke('mods:setEnabled', instance.id, mod.id, enabled);
    } catch (e) {
      setItems((list) => list.map((m) => (m.id === mod.id ? { ...m, enabled: !enabled } : m)));
      toast('error', 'Не удалось переключить', e instanceof Error ? e.message : String(e));
    }
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const list = await api.invoke<{ modId: string; latest: CatalogVersion }[]>('mods:checkUpdates', instance.id);
      setUpdates(Object.fromEntries(list.map((u) => [u.modId, u.latest])));
      toast(list.length ? 'info' : 'success', list.length ? `Доступно обновлений: ${list.length}` : 'Всё актуально');
    } catch (e) {
      toast('error', 'Не удалось проверить обновления', e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const update = async (mod: InstalledMod, quiet = false) => {
    setBusyId(mod.id);
    try {
      await api.invoke('mods:update', instance.id, mod.id);
      setUpdates((u) => {
        const next = { ...u };
        delete next[mod.id];
        return next;
      });
      if (!quiet) toast('success', `${mod.name} обновлён`, 'Прошлая версия сохранена — её можно вернуть кнопкой отката.');
    } catch (e) {
      toast('error', `Не удалось обновить ${mod.name}`, e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId('');
    }
  };

  const updateAll = async () => {
    setUpdatingAll(true);
    const list = items.filter((m) => updates[m.id]);
    for (const mod of list) await update(mod, true);
    await reload();
    setUpdatingAll(false);
    toast('success', `Обновлено: ${list.length}`, 'Прошлые версии сохранены в бэкапах сборки.');
  };

  const rollback = async (mod: InstalledMod) => {
    setBusyId(mod.id);
    try {
      await api.invoke('mods:rollback', instance.id, mod.id);
      await reload();
      toast('success', `${mod.name}: прошлая версия возвращена`);
    } catch (e) {
      toast('error', 'Откат не удался', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId('');
    }
  };

  const remove = async (mod: InstalledMod) => {
    setToRemove(null);
    try {
      await api.invoke('mods:remove', instance.id, mod.id);
      await reload();
      toast('success', `${mod.name} удалён из сборки`);
    } catch (e) {
      toast('error', 'Не удалось удалить', e instanceof Error ? e.message : String(e));
    }
  };

  const addFiles = async () => {
    const files = await api.invoke<string[]>('dialog:files', `Добавить: ${kindTab.label.toLowerCase()}`, [
      { name: kindTab.label, extensions: kindTab.ext }
    ]);
    if (!files.length) return;
    const added = await api.invoke<number>('mods:addFiles', instance.id, kind, files);
    await reload();
    toast(added ? 'success' : 'warning', added ? `Добавлено файлов: ${added}` : 'Подходящих файлов нет', added ? undefined : `Нужны файлы .${kindTab.ext.join(', .')}`);
    if (added) void api.invoke<number>('mods:identify', instance.id).then((n) => (n > 0 ? reload() : undefined)).catch(() => undefined);
  };

  const openProject = async (mod: InstalledMod) => {
    if (!mod.projectId || mod.source === 'local') return;
    try {
      const p = await api.invoke<CatalogProject | null>('catalog:project', mod.source, mod.projectId);
      if (!p) throw new Error('Проект не найден в каталоге');
      setProject({ project: p, kind: mod.kind as ContentType });
      setCatalogOpen(true);
    } catch (e) {
      toast('error', 'Не удалось открыть страницу', e instanceof Error ? e.message : String(e));
    }
  };

  const duplicate = async () => {
    const copy = await api.invoke<Instance | null>('instances:duplicate', instance.id);
    if (copy) {
      toast('success', 'Копия создана', copy.name);
      onChanged();
    }
  };

  const shortcut = async () => {
    try {
      const file = await api.invoke<string>('instance:shortcut', instance.id);
      toast('success', 'Ярлык создан', file);
    } catch (e) {
      toast('error', 'Не удалось создать ярлык', e instanceof Error ? e.message : String(e));
    }
  };

  const exportPack = async (format: 'mrpack' | 'curseforge') => {
    try {
      const file = await api.invoke<string | null>(format === 'mrpack' ? 'modpack:export' : 'modpack:exportCurseForge', instance.id);
      if (file) toast('success', 'Сборка экспортирована', file);
    } catch (e) {
      toast('error', 'Экспорт не удался', e instanceof Error ? e.message : String(e));
    }
  };

  const askDelete = async () => {
    setWorlds(await api.invoke<number>('instances:worldCount', instance.id));
    setConfirmDelete(true);
  };

  const cover = instance.coverDataUrl
    ? { backgroundImage: `url(${instance.coverDataUrl})` }
    : {
        ['--cover-a' as string]: `hsl(${instance.iconHue} 32% 46%)`,
        ['--cover-b' as string]: `hsl(${(instance.iconHue + 45) % 360} 30% 70%)`
      };

  return (
    <div className="screen instance-page">
      <div className="row" style={{ gap: 10 }}>
        <Button variant="secondary" size="sm" icon={<ArrowLeft size={15} />} onClick={onBack}>
          Все сборки
        </Button>
      </div>

      <section className={`instance-hero ${instance.coverDataUrl ? 'instance-hero--image' : ''}`} style={cover}>
        <div className="instance-hero__shade" />
        <div className="instance-hero__content">
          <span className="instance-hero__badge" aria-hidden>
            {instance.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="instance-hero__text">
            <h1 className="instance-hero__title" data-i18n-skip>
              {instance.name}
            </h1>
            <p className="instance-hero__meta">
              {LOADER_NAME[instance.loader.kind] ?? instance.loader.kind}
              {instance.loader.version ? ` ${instance.loader.version}` : ''}, Minecraft {instance.gameVersion}
            </p>
            <p className="instance-hero__meta instance-hero__meta--soft">
              <Clock3 size={13} />{' '}
              {instance.lastPlayedAt
                ? `${fmtPlaytime(instance.playtimeMinutes)} в игре, последний запуск ${fmtRelative(instance.lastPlayedAt)}`
                : `${fmtPlaytime(instance.playtimeMinutes)} в игре`}
            </p>
          </div>
          <div className="instance-hero__actions">
            <Button
              size="lg"
              glow={!running}
              variant={running ? 'danger' : 'primary'}
              loading={starting}
              icon={running ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              onClick={play}
            >
              {running ? 'Остановить' : 'Играть'}
            </Button>
            <IconButton
              label={instance.favorite ? 'Убрать из избранного' : 'В избранное'}
              onClick={async () => {
                await api.invoke('instances:update', instance.id, { favorite: !instance.favorite });
                onChanged();
              }}
            >
              <Star size={17} fill={instance.favorite ? 'currentColor' : 'none'} />
            </IconButton>
            <IconButton label="Открыть папку сборки" onClick={() => api.invoke('instances:folder', instance.id)}>
              <FolderOpen size={17} />
            </IconButton>
            <IconButton label="Настройки сборки: память, Java, обложка" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={17} />
            </IconButton>
          </div>
        </div>
      </section>

      <div className="instance-page__layout">
        <div className="instance-page__main">
          <div className="instance-toolbar">
            <Tabs
              value={tab}
              onChange={(k: Tab) => {
                setTab(k);
                setFilter('all');
                setCategory('');
              }}
              items={[
                ...KIND_TABS.map((t) => ({ id: t.id as Tab, label: t.label, count: counts[t.id] })),
                { id: 'worlds' as Tab, label: 'Миры' }
              ]}
            />
            <div className="grow" />
            {tab !== 'worlds' && (
              <div className="instance-toolbar__actions">
                {aiOn && instance.loader.kind !== 'vanilla' && (
                  <Button variant="secondary" size="sm" icon={<Wand2 size={15} />} onClick={() => setImproveOpen(true)}>
                    Улучшить с ИИ
                  </Button>
                )}
                <Button variant="secondary" size="sm" icon={<FilePlus2 size={15} />} onClick={addFiles}>
                  Добавить файлы
                </Button>
                <Button
                  size="sm"
                  icon={<Library size={15} />}
                  onClick={() => {
                    setProject(null);
                    setCatalogOpen(true);
                  }}
                >
                  Найти в каталоге
                </Button>
              </div>
            )}
          </div>

          {tab === 'worlds' ? (
            <WorldsScreen instanceId={instance.id} embedded />
          ) : (
          <>
          <div className="instance-toolbar">
            <div className="instance-toolbar__search">
              <SearchField value={query} onChange={setQuery} placeholder={`Поиск: ${kindTab.label.toLowerCase()} этой сборки`} />
            </div>
            {tab === 'mod' && categoryOptions.length > 0 && (
              <Select
                value={category}
                onChange={setCategory}
                width={180}
                options={[{ value: '', label: 'Все категории' }, ...categoryOptions.map((c) => ({ value: c.id, label: c.label }))]}
              />
            )}
            <Select
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              width={180}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'enabled', label: 'Включённые' },
                { value: 'disabled', label: 'Выключенные' },
                { value: 'updates', label: 'С обновлениями' }
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={checking ? 'spin' : undefined} />}
              onClick={checkUpdates}
              disabled={checking || items.length === 0}
            >
              Проверить обновления
            </Button>
          </div>

          {kindUpdates.length > 0 && (
            <div className="update-strip">
              <Sparkles size={16} />
              <span className="grow">{`Для ${kindUpdates.length} из ${counts[kind]} есть новые версии под Minecraft ${instance.gameVersion}.`}</span>
              <Button size="sm" variant="purple" loading={updatingAll} onClick={updateAll}>{`Обновить все (${updateCount})`}</Button>
            </div>
          )}

          {!loaded ? (
            <div className="content-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 132 }} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<Package size={24} />}
                title={counts[kind] ? 'Ничего не найдено' : kindTab.empty}
                hint={
                  counts[kind]
                    ? 'Измените запрос или фильтр.'
                    : kind === 'mod' && instance.loader.kind === 'vanilla'
                      ? 'Для модов нужна сборка с загрузчиком: Fabric, Forge, NeoForge или Quilt. Ресурспаки работают и без него.'
                      : 'Найдите подходящее в каталоге — версия и загрузчик сборки подставятся сами. Или добавьте свои файлы.'
                }
                action={
                  counts[kind] ? undefined : (
                    <Button icon={<Library size={15} />} onClick={() => setCatalogOpen(true)}>
                      Найти в каталоге
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="content-grid">
              {shown.map((mod) => {
                const next = updates[mod.id];
                const busy = busyId === mod.id;
                const canOpen = !!mod.projectId && mod.source !== 'local';
                return (
                  <article key={mod.id} className={`card content-card ${mod.enabled ? '' : 'is-off'}`}>
                    <div className="content-card__top">
                      {mod.iconUrl ? (
                        <img className="content-card__icon" src={mod.iconUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="content-card__icon content-card__icon--empty">
                          {kind === 'shader' ? <Sparkles size={20} /> : kind === 'resourcepack' ? <ImageIcon size={20} /> : <Package size={20} />}
                        </span>
                      )}
                      <div className="content-card__body">
                        <button
                          className="content-card__title truncate"
                          disabled={!canOpen}
                          title={canOpen ? 'Открыть страницу проекта' : mod.fileName}
                          onClick={() => openProject(mod)}
                        >
                          {mod.name}
                        </button>
                        <span className="content-card__version truncate" title={mod.fileName}>
                          {mod.version !== '—' ? mod.version : mod.fileName}
                        </span>
                        <span className="content-card__source">
                          {mod.source === 'modrinth' ? 'Modrinth' : mod.source === 'curseforge' ? 'CurseForge' : 'Свой файл'}
                          {!mod.enabled && ', выключен'}
                        </span>
                      </div>
                      <Toggle checked={mod.enabled} onChange={(v) => toggle(mod, v)} label={mod.enabled ? 'Выключить' : 'Включить'} />
                    </div>
                    <div className="content-card__foot">
                      {next ? (
                        <Button size="sm" variant="purple" loading={busy} icon={<Download size={13} />} onClick={() => update(mod)}>{`Обновить до ${next.versionNumber}`}</Button>
                      ) : (
                        canOpen && (
                          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => openProject(mod)}>
                            Страница
                          </Button>
                        )
                      )}
                      <div className="grow" />
                      {mod.previousVersionFile && (
                        <IconButton
                          label={`Вернуть прошлую версию${mod.previousVersion ? ` (${mod.previousVersion})` : ''}`}
                          size="sm"
                          ghost
                          disabled={busy}
                          onClick={() => rollback(mod)}
                        >
                          <RotateCcw size={14} />
                        </IconButton>
                      )}
                      <IconButton label="Удалить из сборки" size="sm" ghost onClick={() => setToRemove(mod)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          </>
          )}
        </div>

        <aside className="instance-page__aside">
          <section className="panel">
            <h3 className="panel__title">Здоровье сборки</h3>
            <p className="small muted" style={{ margin: '6px 0 12px' }}>
              Найдёт недостающие зависимости, конфликты, дубликаты и устаревшие версии. Исправляет только то, что вы отметите.
            </p>
            <Button variant="secondary" block icon={<Wrench size={15} />} onClick={() => setBuildCheckOpen(true)}>
              Проверить сборку
            </Button>
          </section>
          <section className="panel instance-page__tools">
            <h3 className="panel__title">Действия</h3>
            <button className="action-row" onClick={duplicate}>
              <Copy size={16} /> Сделать копию
            </button>
            <button className="action-row" onClick={shortcut}>
              <MonitorUp size={16} /> Ярлык на рабочий стол
            </button>
            <button className="action-row" onClick={() => exportPack('mrpack')}>
              <Download size={16} /> Экспорт для Modrinth (.mrpack)
            </button>
            <button className="action-row" onClick={() => exportPack('curseforge')}>
              <Download size={16} /> Экспорт для CurseForge (.zip)
            </button>
            <button className="action-row action-row--danger" onClick={askDelete}>
              <Trash2 size={16} /> Удалить сборку
            </button>
          </section>
        </aside>
      </div>

      <Modal
        open={catalogOpen}
        full
        onClose={() => {
          setCatalogOpen(false);
          setProject(null);
          void reload();
        }}
        title={project ? project.project.title : `Каталог для «${instance.name}»`}
      >
        {project && (
          <ProjectPage
            project={project.project}
            kind={project.kind}
            instance={instance}
            instances={[instance]}
            allowCreate={false}
            onBack={() => setProject(null)}
            onInstalled={() => {
              void reload();
              onChanged();
            }}
          />
        )}
        <div className={project ? 'hidden' : undefined}>
          {catalogOpen && (
            <CatalogBrowser
              instances={[instance]}
              mode="instance"
              instance={instance}
              initialType={kind}
              onOpenProject={(p, k) => setProject({ project: p, kind: k })}
              onInstalled={() => {
                void reload();
                onChanged();
              }}
            />
          )}
        </div>
      </Modal>

      <InstanceSettingsModal
        open={settingsOpen}
        instance={instance}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          void reload();
          onChanged();
        }}
      />

      <AiImproveModal open={improveOpen} instance={instance} modCount={counts.mod} onClose={closeImprove} />
      <BuildCheckModal
        open={buildCheckOpen}
        instance={instance}
        onClose={() => setBuildCheckOpen(false)}
        onChanged={() => {
          void reload();
          onChanged();
        }}
      />

      <ConfirmDialog
        open={!!toRemove}
        title={`Удалить «${toRemove?.name ?? ''}»?`}
        confirmLabel="Удалить"
        danger
        onCancel={() => setToRemove(null)}
        onConfirm={() => toRemove && remove(toRemove)}
      >
        <p>Файл будет удалён из папки сборки. Его можно поставить снова из каталога.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить «${instance.name}»?`}
        confirmLabel="Удалить навсегда"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.invoke('instances:delete', instance.id);
          setConfirmDelete(false);
          toast('success', 'Сборка удалена', instance.name);
          onDeleted();
        }}
      >
        <p>Папка сборки, моды, конфиги и логи будут удалены безвозвратно.</p>
        {worlds > 0 && (
          <p style={{ color: 'var(--danger)', fontWeight: 600 }}>{`Внимание: миров в этой сборке — ${worlds}. Они тоже будут удалены.`}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
