import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Boxes,
  Coffee,
  Cpu,
  Download,
  ChevronRight,
  ExternalLink,
  Globe2,
  Hammer,
  Keyboard,
  Layers,
  Package,
  Palette,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings as SettingsIcon,
  Shirt,
  Terminal,
  Trash2,
  UserRound,
  WifiOff
} from 'lucide-react';
import { api } from '../../api';
import { EmptyState } from '../../ui/Common';
import { GuidesModal } from './GuidesModal';
import { GUIDES, SETTINGS_LINKS, fuzzyMatch, searchGuides, tokens, type Guide } from '../../content/guides';
import type { CatalogSearchResult, Instance } from '../../../shared/types';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  rocket: Rocket,
  hammer: Hammer,
  package: Package,
  cpu: Cpu,
  coffee: Coffee,
  user: UserRound,
  'wifi-off': WifiOff,
  palette: Palette,
  globe: Globe2,
  shirt: Shirt,
  alert: AlertTriangle,
  download: Download,
  boxes: Boxes,
  server: Server,
  refresh: RefreshCw,
  bot: Bot,
  terminal: Terminal,
  layers: Layers,
  keyboard: Keyboard,
  settings: SettingsIcon,
  trash: Trash2,
  search: Search
};

export function GuideIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? BookOpen;
  return <Icon size={size} />;
}

export function LauncherSearch({
  instances,
  onOpenGuide
}: {
  instances: Instance[];
  onOpenGuide: (guide: Guide) => void;
}) {
  const [query, setQuery] = useState('');
  const [mods, setMods] = useState<CatalogSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [allGuides, setAllGuides] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMods(null);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await api.invoke<CatalogSearchResult>('catalog:search', {
          source: 'modrinth',
          projectType: 'mod',
          query: q,
          sort: 'relevance',
          offset: 0,
          limit: 6
        });
        setMods(res);
      } catch {
        setMods(null);
      } finally {
        setLoading(false);
      }
    }, 380);
    return () => clearTimeout(id);
  }, [query]);

  const q = query.trim().toLowerCase();
  const foundGuides = useMemo(() => (q ? searchGuides(query, 6) : []), [query]);
  const foundInstances = useMemo(
    () =>
      q
        ? instances
            .filter((i) => i.name.toLowerCase().includes(q) || i.gameVersion.includes(q) || fuzzyMatch(query, `${i.name} ${i.loader.kind}`))
            .slice(0, 5)
        : [],
    [instances, q]
  );
  const foundSettings = useMemo(() => {
    if (!q) return [];
    // Хоть одно слово запроса (с опечаткой или в другой раскладке)
    return SETTINGS_LINKS.filter((s) =>
      tokens(query).some((w) => fuzzyMatch(w, `${s.title} ${s.hint}`))
    ).slice(0, 4);
  }, [q, query]);

  const nothing =
    q &&
    !foundGuides.length &&
    !foundInstances.length &&
    !foundSettings.length &&
    !(mods?.hits.length ?? 0);

  return (
    <section className="col" style={{ gap: 12 }}>
      <div className="search-hero">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по лаунчеру: сборки, моды, настройки, гайды…"
          autoComplete="off"
        />
        {loading && <span className="btn__spinner" style={{ color: 'var(--accent)' }} />}
      </div>

      {!q && (
        <div className="col" style={{ gap: 12 }} data-tour="guides">
          <div className="section-head">
            <h2 className="section-title">Гайды</h2>
            <button className="section-link" onClick={() => setAllGuides(true)}>
              {GUIDES.length} материалов <ChevronRight size={14} />
            </button>
          </div>
          <div className="guide-grid">
            {GUIDES.slice(0, 6).map((guide) => (
              <button key={guide.id} className="guide-card card card--hover" onClick={() => onOpenGuide(guide)}>
                <span className="guide-card__icon">
                  <GuideIcon name={guide.icon} size={18} />
                </span>
                <span className="guide-card__title">{guide.title}</span>
                <span className="guide-card__summary">{guide.summary}</span>
                <span className="tiny muted">{`${guide.minutes} мин`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {q && (
        <div className="search-results">
          {foundGuides.length > 0 && (
            <div className="search-group">
              <span className="search-group__title">Гайды</span>
              {foundGuides.map((guide) => (
                <button key={guide.id} className="search-item" onClick={() => onOpenGuide(guide)}>
                  <span className="search-item__icon">
                    <GuideIcon name={guide.icon} size={16} />
                  </span>
                  <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{guide.title}</span>
                    <span className="tiny muted truncate">{guide.summary}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {foundInstances.length > 0 && (
            <div className="search-group">
              <span className="search-group__title">Сборки</span>
              {foundInstances.map((inst) => (
                <button
                  key={inst.id}
                  className="search-item"
                  onClick={() => (window.location.hash = `/library?instance=${inst.id}`)}
                >
                  <span className="search-item__icon">
                    <Layers size={16} />
                  </span>
                  <span className="col grow" style={{ gap: 1 }}>
                    <span style={{ fontWeight: 600 }}>{inst.name}</span>
                    <span className="tiny muted">
                      {inst.gameVersion} · {inst.loader.kind}
                    </span>
                  </span>
                  <ExternalLink size={13} className="muted" />
                </button>
              ))}
            </div>
          )}

          {mods && mods.hits.length > 0 && (
            <div className="search-group">
              <span className="search-group__title">Моды и контент</span>
              {mods.hits.map((project) => (
                <button
                  key={project.id}
                  className="search-item"
                  onClick={() => (window.location.hash = `/mods?q=${encodeURIComponent(project.title)}`)}
                >
                  {project.iconUrl ? (
                    <img className="search-item__thumb" src={project.iconUrl} alt="" />
                  ) : (
                    <span className="search-item__icon">
                      <Package size={16} />
                    </span>
                  )}
                  <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }} className="truncate">
                      {project.title}
                    </span>
                    <span className="tiny muted truncate">{project.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {foundSettings.length > 0 && (
            <div className="search-group">
              <span className="search-group__title">Настройки</span>
              {foundSettings.map((item) => (
                <button key={item.id} className="search-item" onClick={() => (window.location.hash = item.hash)}>
                  <span className="search-item__icon">
                    <Search size={15} />
                  </span>
                  <span className="col grow" style={{ gap: 1 }}>
                    <span style={{ fontWeight: 600 }}>{item.title}</span>
                    <span className="tiny muted">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {nothing && (
            <div className="panel">
              <EmptyState
                icon={<Search size={24} />}
                title="Ничего не нашлось"
                hint="Попробуйте короче: «моды», «память», «скин», «вылет». Поиск ищет по гайдам, сборкам, модам и настройкам."
              />
            </div>
          )}
        </div>
      )}
      <GuidesModal open={allGuides} onClose={() => setAllGuides(false)} />
    </section>
  );
}