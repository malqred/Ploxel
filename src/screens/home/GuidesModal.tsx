import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { Modal } from '../../ui/Overlay';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/TextField';
import { EmptyState } from '../../ui/Common';
import { GUIDES, searchGuides, type Guide } from '../../content/guides';
import { GuideArticle } from './GuideView';
import { GuideIcon } from './LauncherSearch';

/** Окно со всеми гайдами: список с поиском, гайд открывается тут же. */
export function GuidesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setGuide(null);
      setQuery('');
    }
  }, [open]);

  const list = useMemo(() => (query.trim() ? searchGuides(query, GUIDES.length) : GUIDES), [query]);

  const openGuide = (g: Guide) => {
    setGuide(g);
    body.current?.closest('.modal')?.scrollTo({ top: 0 });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="modal--guides"
      title={`Все гайды · ${GUIDES.length}`}
    >
      <div ref={body} className="guides-modal">
        {guide ? (
          <>
            <div className="row" style={{ gap: 10 }}>
              <Button variant="secondary" size="sm" icon={<ArrowLeft size={15} />} onClick={() => setGuide(null)}>
                Все гайды
              </Button>
              <span className="tiny muted row" style={{ gap: 4 }}>
                <Clock size={12} /> {`${guide.minutes} мин чтения`}
              </span>
            </div>
            <GuideArticle guide={guide} onOpen={openGuide} plain />
          </>
        ) : (
          <>
            <SearchField value={query} onChange={setQuery} placeholder="Найти гайд: память, вылет, шейдеры…" />
            {list.length === 0 ? (
              <EmptyState title="Ничего не нашлось" hint="Попробуйте другое слово." />
            ) : (
              <div className="guides-modal__grid">
                {list.map((g) => (
                  <button key={g.id} className="guide-card card card--hover" onClick={() => openGuide(g)}>
                    <span className="guide-card__icon">
                      <GuideIcon name={g.icon} size={18} />
                    </span>
                    <span className="guide-card__title">{g.title}</span>
                    <span className="guide-card__summary">{g.summary}</span>
                    <span className="tiny muted">{`${g.minutes} мин`}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
