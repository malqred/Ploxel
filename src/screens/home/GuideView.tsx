import { ArrowLeft, Clock } from 'lucide-react';
import { Button } from '../../ui/Button';
import { GUIDES, type Guide } from '../../content/guides';

/** Текст гайда: используется и на отдельной странице, и в окне «Все гайды». */
export function GuideArticle({ guide, onOpen, plain }: { guide: Guide; onOpen: (g: Guide) => void; plain?: boolean }) {
  const related = GUIDES.filter((g) => g.id !== guide.id).slice(0, 3);
  return (
    <article className={`guide-article ${plain ? '' : 'panel'}`}>
      <h1 className="guide-article__title">{guide.title}</h1>
      <p className="guide-article__summary">{guide.summary}</p>

      {guide.sections.map((section, idx) => (
        <section className="guide-section" key={idx}>
          <h2 className="guide-section__heading">{section.heading}</h2>
          {section.text && <p className="guide-section__text">{section.text}</p>}
          {section.steps && (
            <ol className="guide-steps">
              {section.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          {section.note && <div className="guide-note">{section.note}</div>}
        </section>
      ))}

      <div className="divider" />
      <h3 className="guide-section__heading">Читайте также</h3>
      <div className="guide-related">
        {related.map((g) => (
          <button key={g.id} className="guide-related__item" onClick={() => onOpen(g)}>
            <span style={{ fontWeight: 600 }}>{g.title}</span>
            <span className="tiny muted">{g.summary}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

export function GuideView({ guide, onBack, onOpen }: { guide: Guide; onBack: () => void; onOpen: (g: Guide) => void }) {
  return (
    <div className="screen guide-view">
      <div className="row" style={{ gap: 10 }}>
        <Button variant="secondary" size="sm" icon={<ArrowLeft size={15} />} onClick={onBack}>
          Назад к поиску
        </Button>
        <span className="tiny muted row" style={{ gap: 4 }}>
          <Clock size={12} /> {`${guide.minutes} мин чтения`}
        </span>
      </div>
      <GuideArticle guide={guide} onOpen={onOpen} />
    </div>
  );
}
