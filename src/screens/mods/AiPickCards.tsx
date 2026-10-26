import { Download, Package } from 'lucide-react';
import { Toggle } from '../../ui/Controls';
import { fmtNumber } from '../../i18n';
import type { CatalogProject } from '../../../shared/types';

/** Общие карточки ИИ-подбора: «Подобрать с ИИ» и «Улучшить с ИИ». */

export type PickKind = 'mod' | 'resourcepack' | 'shader';
export type PickLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge';
export interface PickItem {
  project: CatalogProject;
  kind: PickKind;
  reason?: string;
}
export interface BuildPick {
  gameVersion: string;
  loader: PickLoader;
  name?: string;
  summary?: string;
  items: PickItem[];
  missing: string[];
  dropped: string[];
}

export const LOADER_LABEL: Record<PickLoader, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
};

const SECTIONS: { kind: PickKind; title: string }[] = [
  { kind: 'mod', title: 'Моды' },
  { kind: 'resourcepack', title: 'Ресурспаки' },
  { kind: 'shader', title: 'Шейдеры' }
];

export function AiPickCards({
  pick,
  off,
  toggle
}: {
  pick: BuildPick;
  off: Set<string>;
  toggle: (projectId: string) => void;
}) {
  const selected = pick.items.filter((i) => !off.has(i.project.id)).length;
  return (
    <div className="ai-pick">
      <div className="ai-pick__head">
        <span className="chip chip--accent">{`${LOADER_LABEL[pick.loader]} ${pick.gameVersion}`}</span>
        {pick.summary && <span className="small soft">{pick.summary}</span>}
        <span className="tiny muted ai-pick__count">{`Выбрано ${selected} из ${pick.items.length}`}</span>
      </div>
      {SECTIONS.map(({ kind, title }) => {
        const list = pick.items.filter((i) => i.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="col" style={{ gap: 8 }}>
            <h3 className="panel__title">{title}</h3>
            <div className="mods-grid">
              {list.map((item, idx) => {
                const on = !off.has(item.project.id);
                return (
                  <article
                    key={item.project.id}
                    className="card card--hover mod-card ai-pick__card rise-in"
                    data-off={on ? undefined : 'true'}
                    style={{ ['--i' as string]: idx }}
                    onClick={() => toggle(item.project.id)}
                  >
                    <div className="mod-card__top">
                      {item.project.iconUrl ? (
                        <img className="mod-card__icon" src={item.project.iconUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="mod-card__icon mod-card__icon--empty">
                          <Package size={22} />
                        </span>
                      )}
                      <div className="mod-card__body">
                        <span className="mod-card__title">{item.project.title}</span>
                        <span className="mod-card__desc">{item.reason || item.project.description}</span>
                      </div>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Toggle checked={on} onChange={() => toggle(item.project.id)} label={item.project.title} />
                      </span>
                    </div>
                    <div className="mod-card__foot">
                      <span className="mod-card__meta">
                        <span className="row" style={{ gap: 3 }}>
                          <Download size={11} /> {fmtNumber(item.project.downloads)}
                        </span>
                        <span className="truncate">{item.project.author}</span>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {pick.dropped.length > 0 && <p className="tiny muted">{`Убраны дубли: ${pick.dropped.join('; ')}`}</p>}
      {pick.missing.length > 0 && <p className="tiny muted">{`Не нашлись на Modrinth для этой версии: ${pick.missing.join(', ')}`}</p>}
      <p className="tiny muted">Зависимости (Fabric API и другие библиотеки) лаунчер докачает сам.</p>
    </div>
  );
}
