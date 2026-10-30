import { useEffect, useMemo, useState } from 'react';
import { ImageViewer } from '../../ui/ImageViewer';
import { ArrowLeft, Calendar, Download, ExternalLink, Languages, PackageCheck, Plus, Users } from 'lucide-react';
import { api } from '../../api';
import { Button, IconButton } from '../../ui/Button';
import { Checkbox, Tabs } from '../../ui/Controls';
import { Select } from '../../ui/TextField';
import { Markdown } from '../../ui/Markdown';
import { EmptyState } from '../../ui/Common';
import { DependencyPreviewModal } from './DependencyPreviewModal';
import { useSettings } from '../../state/settings';
import { useToast } from '../../state/toast';
import { fmtBytes, fmtDate, fmtNumber } from '../../i18n';
import { sortGameVersions, summarizeGameVersions } from '../../../shared/game-versions';
import { newInstanceTarget } from '../../../shared/instance-target';
import type { CatalogProject, CatalogVersion, Instance, InstalledMod } from '../../../shared/types';

const KIND_BY_TYPE = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader',
  modpack: 'modpack'
} as const;

const LOADERS = [
  { value: '', label: 'Любой загрузчик' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' }
];

type Tab = 'main' | 'gallery' | 'versions';

const CREATE_TARGET = '__create__';

export function ProjectPage({
  project,
  kind,
  instance,
  instances,
  onBack,
  onInstalled,
  onInstanceCreated,
  allowCreate = true
}: {
  project: CatalogProject;
  kind: 'mod' | 'modpack' | 'resourcepack' | 'shader';
  instance: Instance | null;
  instances: Instance[];
  onBack: () => void;
  onInstalled: () => void;
  onInstanceCreated?: (instance: Instance) => void;
  /** «Создать новую» на странице проекта: скрыта внутри уже открытой сборки */
  allowCreate?: boolean;
}) {
  const { settings } = useSettings();
  const [full, setFull] = useState<CatalogProject>(project);
  const [versions, setVersions] = useState<CatalogVersion[]>([]);
  const [chosen, setChosen] = useState('');
  const [tab, setTab] = useState<Tab>('main');
  const [targetId, setTargetId] = useState(instance?.id ?? '');
  const [localInstances, setLocalInstances] = useState<Instance[]>(instances);
  const [creatingTarget, setCreatingTarget] = useState(false);
  const [filterVersion, setFilterVersion] = useState(instance?.gameVersion ?? '');
  const [filterLoader, setFilterLoader] = useState(
    instance && instance.loader.kind !== 'vanilla' ? instance.loader.kind : ''
  );
  const [installed, setInstalled] = useState<InstalledMod | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [loading, setLoading] = useState(true);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState<{ summary: string; body: string; provider: string; truncated: boolean } | null>(null);
  const [snapshots, setSnapshots] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const { toast } = useToast();
  const language = settings?.general.language ?? 'ru';

  const translate = async () => {
    setTranslating(true);
    try {
      // Полное описание могло ещё не загрузиться — без него переводилась бы
      // только короткая аннотация.
      const source =
        full.body ??
        (await api.invoke<CatalogProject | null>('catalog:project', project.source, project.id).catch(() => null))?.body;
      // Аннотация и описание — одним запросом: запасному переводчику с лимитом
      // запросов в минуту так хватает квоты на всю страницу
      const page = await api.invoke<{ summary: string; body: string; provider: string; truncated: boolean }>(
        'translate:page',
        full.description,
        source || full.description,
        language
      );
      setTranslated(page);
      setShowTranslated(true);
    } catch (e) {
      toast('error', 'Не удалось перевести', e instanceof Error ? e.message : String(e));
    } finally {
      setTranslating(false);
    }
  };

  const button = async () => {
    if (showTranslated) {
      setShowTranslated(false);
      return;
    }
    if (translated) setShowTranslated(true);
    else await translate();
  };

  const target = localInstances.find((i) => i.id === targetId) ?? null;
  // Загрузчик важен модам и модпакам: у модпака бывают версии под Fabric и NeoForge
  const usesLoader = kind === 'mod' || kind === 'modpack';
  const mismatch = !!(target && filterVersion && filterVersion !== target.gameVersion);

  useEffect(() => {
    setLocalInstances(instances);
  }, [instances]);

  useEffect(() => {
    void api
      .invoke<CatalogProject | null>('catalog:project', project.source, project.id)
      .then((p) => p && setFull(p))
      .catch(() => undefined);
  }, [project.id]);

  useEffect(() => {
    setLoading(true);
    api
      .invoke<CatalogVersion[]>(
        'catalog:versions',
        project.source,
        project.id,
        filterVersion || undefined,
        usesLoader && filterLoader ? filterLoader : undefined
      )
      .then((list) => {
        setVersions(list);
        setChosen((cur) => (list.some((v) => v.id === cur) ? cur : list[0]?.id ?? ''));
      })
      .catch((e) => toast('error', 'Не удалось получить версии', e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [project.id, project.source, filterVersion, filterLoader, usesLoader]);

  useEffect(() => {
    if (!target) {
      setInstalled(null);
      return;
    }
    setInstalled(null);
    void api.invoke<InstalledMod[]>('mods:list', target.id).then((list) => {
      setInstalled(list.find((m) => m.projectId === project.id) ?? null);
    });
  }, [target?.id, project.id]);

  const chooseTarget = (id: string) => {
    if (id === CREATE_TARGET) {
      void createTarget();
      return;
    }
    setTargetId(id);
    const inst = localInstances.find((i) => i.id === id);
    if (inst) {
      setFilterVersion(inst.gameVersion);
      setFilterLoader(inst.loader.kind === 'vanilla' ? '' : inst.loader.kind);
    }
  };

  /**
   * «Создать новую»: сборка называется как проект, версия игры и загрузчик
   * берутся из фильтров — их уже подставили по выбранной сборке или самому моду.
   */
  const createTarget = async () => {
    if (creatingTarget) return;
    const spec = newInstanceTarget({
      kind,
      filterVersion,
      targetVersion: target?.gameVersion,
      fileGameVersions: versions[0]?.gameVersions,
      projectGameVersions: full.gameVersions,
      filterLoader,
      projectLoaders: full.loaders
    });
    if (!spec) {
      toast('warning', 'Сначала выберите версию игры', 'Новая сборка создаётся на конкретной версии Minecraft.');
      return;
    }
    setCreatingTarget(true);
    try {
      const created = await api.invoke<Instance>('instances:create', {
        name: full.title,
        gameVersion: spec.gameVersion,
        loader: { kind: spec.loader },
        memoryMb: settings?.general.memoryMb
      });
      setLocalInstances((cur) => [...cur, created]);
      onInstanceCreated?.(created);
      setTargetId(created.id);
      setFilterVersion(created.gameVersion);
      if (kind === 'mod' && created.loader.kind !== 'vanilla') setFilterLoader(created.loader.kind);
      toast('success', 'Сборка создана', `${created.name} · ${created.gameVersion}`);
    } catch (e) {
      toast('error', 'Не удалось создать сборку', e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingTarget(false);
    }
  };

  const gameVersionOptions = useMemo(() => {
    const list = sortGameVersions(
      [...(full.gameVersions ?? []), ...versions.flatMap((v) => v.gameVersions)],
      snapshots
    );
    // Текущий фильтр и версия сборки всегда в списке, даже если это снапшот
    for (const extra of [target?.gameVersion, filterVersion]) {
      if (extra && !list.includes(extra)) list.unshift(extra);
    }
    return list.slice(0, 150).map((v) => ({ value: v, label: v }));
  }, [full.gameVersions, versions, target?.gameVersion, filterVersion, snapshots]);

  const install = async (versionId?: string) => {
    if (!target) {
      toast('warning', 'Выберите сборку', 'Установка идёт в конкретную сборку.');
      return;
    }
    const targetVersion = versionId ?? chosen;
    if (!targetVersion) return;
    if (kind === 'mod') {
      setPreviewVersion(targetVersion);
      return;
    }
    setBusy(true);
    try {
      if (kind === 'modpack') {
        const created = await api.invoke<Instance>('modpack:installFromProject', project.source, project.id, targetVersion);
        const manual = await api.invoke<number>('modpack:manualMods', created.id).catch(() => 0);
        if (manual > 0) {
          toast(
            'warning',
            `Модпаку нужны моды, которые есть только на CurseForge: ${manual}`,
            'При первом запуске модпак сам откроет окно со ссылками — скачайте файлы и положите в папку mods сборки.'
          );
        } else toast('success', 'Сборка создана', created.name);
        window.location.hash = `/library?instance=${created.id}`;
        return;
      }
      const res = await api.invoke<{ installed: InstalledMod; dependencies: string[] }>(
        'mods:install',
        target.id,
        project.source,
        project.id,
        KIND_BY_TYPE[kind],
        { versionId: targetVersion, projectName: full.title, projectIcon: full.iconUrl }
      );
      setChosen(targetVersion);
      setInstalled(res.installed);
      onInstalled();
      toast(
        'success',
        `${full.title} установлен`,
        res.dependencies.length ? `Докачано зависимостей: ${res.dependencies.length}` : 'Можно включать в игре.'
      );
    } catch (e) {
      toast('error', 'Установка не удалась', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (version: CatalogVersion) => {
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) {
      toast('warning', 'У этой версии нет файла для скачивания');
      return;
    }
    setDownloading(version.id);
    try {
      const saved = await api.invoke<string>('download:file', file.url, file.fileName, file.hashes?.sha1);
      toast('success', 'Файл скачан', saved);
      await api.shell.showItem(saved);
    } catch (e) {
      toast('error', 'Не удалось скачать', e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading('');
    }
  };

  const version = versions.find((v) => v.id === chosen);
  const primaryFile = version?.files.find((f) => f.primary) ?? version?.files[0];
  const gallery = full.gallery ?? [];

  return (
    <div className="screen project-page">
      <div className="row" style={{ gap: 10 }}>
        <Button variant="secondary" size="sm" icon={<ArrowLeft size={15} />} onClick={onBack}>
          Назад в библиотеку
        </Button>
        <span className="tiny muted">{project.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>
        <div className="grow" />
        <Button
          variant={showTranslated ? 'primary' : 'ghost'}
          size="sm"
          icon={<Languages size={14} />}
          loading={translating}
          onClick={button}
        >
          {showTranslated ? 'Оригинал' : 'Перевод'}
        </Button>
        <Button variant="ghost" size="sm" icon={<ExternalLink size={14} />} onClick={() => api.shell.openExternal(project.url)}>
          Сайт проекта
        </Button>
      </div>

      <section className="project-hero panel">
        <div className="project-hero__head">
          {full.iconUrl ? (
            <img className="project-hero__icon" src={full.iconUrl} alt="" />
          ) : (
            <span className="project-hero__icon project-hero__icon--empty">
              <Download size={26} />
            </span>
          )}
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            <h1 className="project-hero__title">{full.title}</h1>
            <span className="small muted">{full.author}</span>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="chip">
                <Download size={12} /> {fmtNumber(full.downloads)}
              </span>
              <span className="chip">
                <Calendar size={12} /> {fmtDate(full.updatedAt)}
              </span>
              {full.loaders.map((l) => (
                <span key={l} className="chip">{l}</span>
              ))}
              {full.categories
                .filter((c) => c.toLowerCase() !== 'babric')
                .filter((c) => !full.loaders.some((l) => l.toLowerCase() === c.toLowerCase()))
                .filter((c, idx, arr) => arr.findIndex((x) => x.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === c.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()) === idx)
                .slice(0, 4)
                .map((c) => (
                  <span key={c} className="chip chip--accent">{c}</span>
                ))}
            </div>
          </div>
        </div>
        <p className="project-hero__summary">
          {showTranslated && translated ? translated.summary : full.description}
        </p>
      </section>

      <div className="project-tabs">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'main', label: 'Основное' },
            { id: 'gallery', label: 'Галерея', count: gallery.length },
            { id: 'versions', label: 'Версии', count: versions.length }
          ]}
        />
      </div>

      <div className="project-layout">
        <div className="project-main">
          {tab === 'main' && (
            <div className="panel project-body">
              {loading && <div className="skeleton" style={{ height: 120 }} />}
              {!loading && (
                <>
                  <Markdown
                    text={
                      showTranslated && translated
                        ? translated.body
                        : full.body || full.description || 'Автор не добавил описание.'
                    }
                  />
                  {showTranslated && (
                    <p className="tiny muted" style={{ marginTop: 10 }}>{`Автоматический перевод (${translated?.provider === 'google' ? 'Google' : translated?.provider === 'libre' ? 'LibreTranslate' : 'MyMemory'}).${translated?.truncated ? ' Длинное описание переведено частично — конец оставлен в оригинале.' : ''} Оригинал — кнопкой «Оригинал» сверху.`}</p>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'gallery' &&
            (gallery.length === 0 ? (
              <div className="panel">
                <EmptyState
                  title="Галерея пуста"
                  hint="Автор не добавил изображения к этому проекту."
                />
              </div>
            ) : (
              <div className="gallery-grid">
                {gallery.map((src, idx) => (
                  <button
                    key={src}
                    className="gallery-item"
                    onClick={() => setViewing(idx)}
                    title="Открыть изображение"
                  >
                    <img src={src} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            ))}

          {tab === 'versions' && (
            <div className="panel versions-panel">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 className="panel__title">История версий</h3>
                <span className="tiny muted">
                  {loading ? 'Загрузка…' : `${versions.length} файлов по фильтрам`}
                </span>
              </div>
              {versions.length === 0 && !loading ? (
                <EmptyState title="Нет версий" hint="Под выбранные версию игры и загрузчик файлов нет." />
              ) : (
                <div className="versions-list">
                  {versions.map((v) => {
                    const file = v.files.find((f) => f.primary) ?? v.files[0];
                    return (
                      <div className="version-row" key={v.id}>
                        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                          <span className="version-row__name">{v.versionNumber || v.name}</span>
                          <span className="tiny muted">
                            {fmtDate(v.datePublished)}
                            {v.gameVersions.length ? ` · ${summarizeGameVersions(v.gameVersions)}` : ''}
                            {v.loaders.length ? ` · ${v.loaders.join(', ')}` : ''}
                            {file ? ` · ${fmtBytes(file.size)}` : ''}
                          </span>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <IconButton
                            label="Скачать файл"
                            size="sm"
                            disabled={!file || downloading === v.id}
                            onClick={() => download(v)}
                          >
                            <Download size={15} />
                          </IconButton>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy && chosen === v.id}
                            disabled={!target || !file}
                            onClick={() => install(v.id)}
                          >
                            Установить
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="project-side panel">
          <h3 className="panel__title">Установка</h3>

          <span className="field__label">Куда установить</span>
          <Select
            value={targetId}
            options={[
              ...(allowCreate
                ? [
                    {
                      value: CREATE_TARGET,
                      label: 'Создать новую сборку',
                      hint: full.title,
                      icon: <Plus size={14} />
                    }
                  ]
                : []),
              ...localInstances.map((i) => ({ value: i.id, label: i.name, hint: i.gameVersion }))
            ]}
            onChange={chooseTarget}
            placeholder={
              allowCreate
                ? creatingTarget
                  ? 'Создаём сборку…'
                  : 'Создать новую или выбрать существующую'
                : localInstances.length
                  ? 'Выберите сборку'
                  : 'Сборок нет'
            }
            disabled={creatingTarget}
            width="100%"
            skipLabels
          />

          <div className="divider" />

          <span className="field__label">Версия игры</span>
          <Select
            value={filterVersion}
            options={[{ value: '', label: 'Все версии' }, ...gameVersionOptions]}
            onChange={setFilterVersion}
            width="100%"
          />
          <div className="tiny muted row" style={{ gap: 8 }}>
            <Checkbox checked={snapshots} onChange={setSnapshots} label="Показывать снапшоты" />
            <span>Показывать снапшоты и пре-релизы</span>
          </div>

          {usesLoader && (
            <>
              <span className="field__label">Загрузчик</span>
              <Select value={filterLoader} options={LOADERS} onChange={setFilterLoader} width="100%" />
            </>
          )}

          <span className="field__label">Версия файла</span>
          {loading ? (
            <div className="skeleton" style={{ height: 44 }} />
          ) : versions.length === 0 ? (
            <p className="small muted">Нет файлов под выбранные фильтры.</p>
          ) : (
            <Select
              value={chosen}
              options={versions.slice(0, 60).map((v) => ({
                value: v.id,
                label: `${v.versionNumber || v.name} · ${fmtDate(v.datePublished)}`
              }))}
              onChange={setChosen}
              width="100%"
            />
          )}
          {primaryFile && (
            <span className="tiny muted">
              {primaryFile.fileName} · {fmtBytes(primaryFile.size)}
            </span>
          )}

          {mismatch && target && (
            <div className="notice">
              <div>{`Файл выбран для ${filterVersion}, а сборка на ${target.gameVersion}. Он может не запуститься.`}</div>
            </div>
          )}

          {kind === 'mod' && target && target.loader.kind === 'vanilla' && (
            <div className="notice">
              <div>В сборке без загрузчика моды не работают. Выберите сборку с Fabric, Forge, NeoForge или Quilt.</div>
            </div>
          )}

          {installed && installed.fileName ? (
            <Button variant="neutral" disabled icon={<PackageCheck size={16} />}>Уже установлено</Button>
          ) : (
            <Button
              onClick={() => install()}
              loading={busy}
              disabled={!chosen || !target || loading || (kind === 'mod' && target?.loader.kind === 'vanilla')}
              block
            >
              {kind === 'modpack' ? 'Создать сборку' : 'Установить'}
            </Button>
          )}

          <div className="divider" />
          <span className="tiny muted row" style={{ gap: 6 }}>
            <Users size={12} /> Обязательных зависимостей: {version?.dependencies.filter((d) => d.required).length ?? 0}
          </span>
          <span className="tiny muted">Помощник при сборке докачает их автоматически.</span>
        </aside>
      </div>

      <DependencyPreviewModal
        open={!!previewVersion && !!target}
        instance={target}
        source={project.source}
        projectId={project.id}
        projectName={full.title}
        iconUrl={full.iconUrl}
        versionId={previewVersion ?? undefined}
        onClose={() => setPreviewVersion(null)}
        onInstalled={() => {
          if (target) {
            void api.invoke<InstalledMod[]>('mods:list', target.id).then((list) => {
              setInstalled(list.find((m) => m.projectId === project.id) ?? null);
            });
          }
          onInstalled();
        }}
      />
      <ImageViewer
        images={gallery.map((src) => ({ src }))}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}