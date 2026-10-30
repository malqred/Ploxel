import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Lock, Package, Search } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Controls';
import { SearchField, Select } from '../../ui/TextField';
import { EmptyState } from '../../ui/Common';
import { useToast } from '../../state/toast';
import { useSettings } from '../../state/settings';
import { fmtNumber } from '../../i18n';
import type { CatalogProject, CatalogSearchResult, CatalogVersion, Instance, InstalledMod } from '../../../shared/types';

export type ContentType = 'mod' | 'modpack' | 'resourcepack' | 'shader';
export type Source = 'modrinth' | 'curseforge';

const TYPE_LABEL: Record<ContentType, string> = {
  mod: 'Моды',
  modpack: 'Сборки',
  resourcepack: 'Ресурспаки',
  shader: 'Шейдеры'
};

const CATEGORIES: Record<ContentType, { id: string; label: string }[]> = {
  mod: [
    { id: 'adventure', label: 'Приключения' },
    { id: 'decoration', label: 'Украшения' },
    { id: 'equipment', label: 'Снаряжение' },
    { id: 'food', label: 'Еда' },
    { id: 'magic', label: 'Магия' },
    { id: 'optimization', label: 'Оптимизация' },
    { id: 'technology', label: 'Технологии' },
    { id: 'worldgen', label: 'Генерация' },
    { id: 'library', label: 'Библиотеки' }
  ],
  modpack: [
    { id: 'adventure', label: 'Приключения' },
    { id: 'optimization', label: 'Оптимизация' },
    { id: 'technology', label: 'Технологии' }
  ],
  resourcepack: [
    { id: 'realistic', label: 'Реалистичные' },
    { id: 'medieval', label: 'Средневековые' },
    { id: 'simplistic', label: 'Минимализм' }
  ],
  shader: [
    { id: 'realistic', label: 'Реалистичные' },
    { id: 'lighting', label: 'Освещение' },
    { id: 'cartoon', label: 'Мультяшные' }
  ]
};

export function CatalogBrowser({
  instances,
  mode,
  instance,
  initialType = 'mod',
  initialQuery = '',
  onOpenProject,
  onInstalled
}: {
  instances: Instance[];
  mode: 'instance' | 'browse';
  instance: Instance | null;
  initialType?: ContentType;
  initialQuery?: string;
  onOpenProject: (project: CatalogProject, kind: ContentType) => void;
  onInstalled?: () => void;
}) {
  const { info } = useSettings();
  // CurseForge работает только с ключом из config.json; без него вкладка выключена
  const cfAvailable = !!info?.config.curseforgeKey;
  const [source, setSource] = useState<Source>('modrinth');
  const [type, setType] = useState<ContentType>(initialType);
  const [query, setQuery] = useState(initialQuery);
  const [gameVersion, setGameVersion] = useState('');
  const [loader, setLoader] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'relevance' | 'downloads' | 'newest' | 'updated'>('relevance');
  const [results, setResults] = useState<CatalogSearchResult | null>(null);
  // При смене каталога карточки прошлого не остаются на экране, пока грузится новый:
  // иначе клик по ним открывал бы проект не из того каталога
  useEffect(() => setResults(null), [source]);
  const [loading, setLoading] = useState(false);
  const [allVersions, setAllVersions] = useState<string[]>([]);
  const requestId = useRef(0);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Что уже стоит в выбранной сборке — на карточке вместо «Скачать» будет «Установлено»
  useEffect(() => {
    setInstalledIds(new Set());
    if (mode !== 'instance' || !instance) return;
    void api
      .invoke<InstalledMod[]>('mods:list', instance.id)
      .then((list) => setInstalledIds(new Set(list.map((m) => m.projectId).filter(Boolean) as string[])))
      .catch(() => undefined);
  }, [mode, instance?.id]);

  const download = async (project: CatalogProject) => {
    if (installing.has(project.id)) return;
    setInstalling((cur) => new Set(cur).add(project.id));
    try {
      if (type === 'modpack') {
        const created = await api.invoke<Instance>('modpack:installFromProject', project.source, project.id);
        toast('success', 'Сборка создана', created.name);
        window.location.hash = `/library?instance=${created.id}`;
        return;
      }
      if (mode === 'instance' && instance) {
        const res = await api.invoke<{ dependencies: string[] }>(
          'mods:install',
          instance.id,
          project.source,
          project.id,
          type,
          { projectName: project.title, projectIcon: project.iconUrl }
        );
        setInstalledIds((cur) => new Set(cur).add(project.id));
        onInstalled?.();
        toast(
          'success',
          `${project.title} установлен`,
          res.dependencies.length ? `Докачано зависимостей: ${res.dependencies.length}` : `Сборка «${instance.name}»`
        );
        return;
      }
      // Режим просмотра: просто скачать файл последней подходящей версии
      const versions = await api.invoke<CatalogVersion[]>(
        'catalog:versions',
        project.source,
        project.id,
        gameVersion || undefined,
        type === 'mod' && loader ? loader : undefined
      );
      const file = versions[0]?.files.find((f) => f.primary) ?? versions[0]?.files[0];
      if (!file) throw new Error('Нет файла под выбранные версию игры и загрузчик.');
      const saved = await api.invoke<string>('download:file', file.url, file.fileName, file.hashes?.sha1);
      toast('success', 'Файл скачан', saved);
      await api.shell.showItem(saved);
    } catch (e) {
      toast('error', 'Не удалось скачать', e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling((cur) => {
        const next = new Set(cur);
        next.delete(project.id);
        return next;
      });
    }
  };

  useEffect(() => {
    void api
      .invoke<{ versions: { id: string; type: string }[] }>('versions:list')
      .then((res) => setAllVersions(res.versions.filter((v) => v.type === 'release').map((v) => v.id)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode === 'instance' && instance) {
      setGameVersion(instance.gameVersion);
      setLoader(instance.loader.kind === 'vanilla' ? '' : instance.loader.kind);
    } else {
      setGameVersion('');
      setLoader('');
    }
  }, [mode, instance?.id]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.invoke<CatalogSearchResult>('catalog:search', {
          source,
          projectType: type,
          query,
          gameVersion: gameVersion || undefined,
          loader: loader || undefined,
          category: category || undefined,
          sort,
          offset: 0,
          limit: 24
        });
        if (id === requestId.current) setResults(res);
      } catch (e) {
        if (id === requestId.current) {
          setResults({ hits: [], total: 0, offset: 0, limit: 24 });
          toast('error', 'Каталог недоступен', e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [source, type, query, gameVersion, loader, category, sort, mode, instance?.id]);

  const loadMore = async () => {
    if (!results) return;
    const offset = results.offset + results.limit;
    const res = await api.invoke<CatalogSearchResult>('catalog:search', {
      source,
      projectType: type,
      query,
      gameVersion: gameVersion || undefined,
      loader: loader || undefined,
      category: category || undefined,
      sort,
      offset,
      limit: 24
    });
    setResults({ ...res, hits: [...results.hits, ...res.hits] });
  };

  const versionOptions = useMemo(() => {
    const list =
      mode === 'instance' && instance
        ? [instance.gameVersion, ...allVersions]
        : [...instances.map((i) => i.gameVersion), ...allVersions];
    return [...new Set(list)].filter(Boolean).map((v) => ({ value: v, label: v }));
  }, [allVersions, instance, mode, instances]);

  return (
    <div className="catalog">
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="segmented" aria-label="Источник">
          <button className="tab" aria-selected={source === 'modrinth'} onClick={() => setSource('modrinth')}>
            Modrinth
          </button>
          <button
            className="tab"
            aria-selected={source === 'curseforge'}
            disabled={!cfAvailable}
            title={cfAvailable ? undefined : 'Каталог CurseForge недоступен: в config.json не задан ключ CurseForge'}
            onClick={() => setSource('curseforge')}
          >
            CurseForge {!cfAvailable && <Lock size={12} />}
          </button>
        </div>
        <Tabs
          value={type}
          onChange={(t) => {
            setType(t);
            setCategory('');
            setSort('relevance');
          }}
          items={(Object.keys(TYPE_LABEL) as ContentType[]).map((t) => ({ id: t, label: TYPE_LABEL[t] }))}
        />
      </div>

      <div className="mods-toolbar">
        <div className="mods-toolbar__search">
          <SearchField value={query} onChange={setQuery} placeholder="Поиск по названию, автору, тегу…" />
        </div>
        <Select
          value={gameVersion}
          options={[{ value: '', label: 'Все версии' }, ...versionOptions]}
          onChange={setGameVersion}
          width={150}
        />
        {type === 'mod' && (
          <Select
            value={loader}
            options={[
              { value: '', label: 'Любой загрузчик' },
              { value: 'fabric', label: 'Fabric' },
              { value: 'forge', label: 'Forge' },
              { value: 'neoforge', label: 'NeoForge' },
              { value: 'quilt', label: 'Quilt' }
            ]}
            onChange={setLoader}
            width={165}
          />
        )}
        <Select
          value={category}
          options={[{ value: '', label: 'Все категории' }, ...CATEGORIES[type].map((c) => ({ value: c.id, label: c.label }))]}
          onChange={setCategory}
          width={165}
        />
        <Select
          value={sort}
          options={[
            { value: 'relevance', label: 'По релевантности' },
            { value: 'downloads', label: 'По загрузкам' },
            { value: 'newest', label: 'Новые' },
            { value: 'updated', label: 'Обновлённые' }
          ]}
          onChange={(v) => setSort(v as typeof sort)}
          width={175}
        />
      </div>

      {mode === 'instance' && instance && (
        <p className="tiny muted">{`Показаны материалы, совместимые с ${instance.loader.kind !== 'vanilla' ? `${instance.gameVersion} · ${instance.loader.kind}` : instance.gameVersion}. Фильтры можно менять.`}</p>
      )}
      {mode === 'browse' && (
        <p className="tiny muted">
          Режим просмотра: совместимость со сборкой не учитывается. Фильтруйте вручную по версии и загрузчику.
        </p>
      )}

      {loading && !results ? (
        <div className="mods-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 150 }} />
          ))}
        </div>
      ) : results && results.hits.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Search size={24} />}
            title="Ничего не найдено"
            hint="Попробуйте изменить запрос, версию игры или загрузчик."
          />
        </div>
      ) : (
        <>
          <div className="mods-grid" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity var(--dur-fast)' }}>
            {results?.hits.map((project, idx) => (
              <article
                key={`${project.source}-${project.id}`}
                className="card card--hover mod-card rise-in"
                style={{ ['--i' as string]: idx }}
                onClick={() => onOpenProject(project, type)}
              >
                <div className="mod-card__top">
                  {project.iconUrl ? (
                    <img className="mod-card__icon" src={project.iconUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="mod-card__icon mod-card__icon--empty">
                      <Package size={22} />
                    </span>
                  )}
                  <div className="mod-card__body">
                    <span className="mod-card__title">{project.title}</span>
                    <span className="mod-card__desc">{project.description}</span>
                    <span className="mod-card__chips">
                      {[...new Map(
                        project.categories
                          .filter((c) => c.toLowerCase() !== 'babric')
                          .map((c) => [c.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), c.trim()])
                      ).values()].slice(0, 3).map((c) => (
                        <span key={c} className="chip" style={{ height: 18, padding: '0 7px', fontSize: 10 }}>
                          {c}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
                <div className="mod-card__foot">
                  <span className="mod-card__meta">
                    <span className="row" style={{ gap: 3 }}>
                      <Download size={11} /> {fmtNumber(project.downloads)}
                    </span>
                    <span className="truncate">{project.author}</span>
                  </span>
                  {installedIds.has(project.id) ? (
                    <Button variant="neutral" size="sm" className="mod-card__action" disabled onClick={(e) => e.stopPropagation()}>
                      <Check size={14} /> Установлено
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mod-card__action"
                      loading={installing.has(project.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void download(project);
                      }}
                    >
                      <Download size={14} /> Скачать
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {results && results.hits.length < results.total && (
            <div className="load-more">
              <Button variant="secondary" onClick={loadMore} loading={loading}>
                Показать ещё
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}