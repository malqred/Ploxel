import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FlaskConical, Languages, Newspaper, Plus, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../ui/Overlay';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Controls';
import { EmptyState } from '../../ui/Common';
import { Markdown } from '../../ui/Markdown';
import { useSettings } from '../../state/settings';
import { useToast } from '../../state/toast';
import { fmtDate } from '../../i18n';
import type { NewsItem, PatchNote, PatchNoteItem } from '../../../shared/types';
import { createInstanceFor } from './MinecraftNews';

type Tab = 'updates' | 'news';
type Filter = 'all' | 'release' | 'snapshot';

/**
 * Окно «Новости Minecraft»: заметки к обновлениям Java Edition (релизы и
 * снапшоты) с полным текстом и созданием сборки на нужной версии, и новости
 * Java Edition со ссылкой на minecraft.net. Источник — launchercontent.mojang.com.
 */
export function MinecraftNewsModal({
  open,
  onClose,
  initialVersion
}: {
  open: boolean;
  onClose: () => void;
  initialVersion?: string;
}) {
  const [tab, setTab] = useState<Tab>('updates');
  const [filter, setFilter] = useState<Filter>('all');
  const [notes, setNotes] = useState<PatchNoteItem[] | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<PatchNoteItem | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setCurrent(null);
      return;
    }
    setTab('updates');
    setError('');
    void api
      .invoke<PatchNoteItem[]>('news:patchNotes')
      .then((list) => {
        setNotes(list);
        const wanted = initialVersion ? list.find((n) => n.version === initialVersion) : undefined;
        if (wanted) setCurrent(wanted);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, initialVersion]);

  useEffect(() => {
    if (open && tab === 'news' && !news) {
      void api
        .invoke<NewsItem[]>('news:java')
        .then(setNews)
        .catch(() => setNews([]));
    }
  }, [open, tab, news]);

  const shown = useMemo(() => (notes ?? []).filter((n) => filter === 'all' || n.type === filter), [notes, filter]);

  const openNote = (n: PatchNoteItem) => {
    setCurrent(n);
    body.current?.closest('.modal')?.scrollTo({ top: 0 });
  };

  return (
    <Modal open={open} onClose={onClose} className="modal--guides" title="Новости Minecraft">
      <div ref={body} className="mc-news">
        {current ? (
          <PatchNoteView item={current} onBack={() => setCurrent(null)} />
        ) : (
          <>
            <Tabs<Tab>
              items={[
                { id: 'updates', label: 'Обновления Java' },
                { id: 'news', label: 'Новости' }
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'updates' ? (
              <>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {(
                    [
                      ['all', 'Все'],
                      ['release', 'Релизы'],
                      ['snapshot', 'Снапшоты и пре-релизы']
                    ] as [Filter, string][]
                  ).map(([id, label]) => (
                    <button key={id} className="chip chip--button" data-active={filter === id ? 'true' : undefined} onClick={() => setFilter(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                {error ? (
                  <EmptyState icon={<Newspaper size={22} />} title="Не удалось загрузить новости" hint={error} />
                ) : !notes ? (
                  <div className="mc-news__grid">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="skeleton" style={{ height: 112 }} />
                    ))}
                  </div>
                ) : (
                  <div className="mc-news__grid">
                    {shown.map((n) => (
                      <button key={n.id} className="mc-news__card" onClick={() => openNote(n)}>
                        <span className={`mc-now__icon ${n.type === 'snapshot' ? 'mc-now__icon--snapshot' : ''}`}>
                          {n.type === 'snapshot' ? <FlaskConical size={18} /> : <Sparkles size={18} />}
                        </span>
                        <span className="col grow" style={{ gap: 4, minWidth: 0 }}>
                          <span className="mc-news__title" data-i18n-skip>
                            {n.title}
                          </span>
                          <span className="tiny muted">{`${n.type === 'release' ? 'Релиз' : 'Снапшот'} · ${fmtDate(n.date)}`}</span>
                          {n.summary && (
                            <span className="small soft mc-news__summary" data-i18n-skip>
                              {n.summary}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : !news ? (
              <div className="mc-news__grid">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="skeleton" style={{ height: 140 }} />
                ))}
              </div>
            ) : news.length === 0 ? (
              <EmptyState icon={<Newspaper size={22} />} title="Новостей нет" hint="Проверьте подключение к интернету и откройте окно ещё раз." />
            ) : (
              <div className="mc-news__grid">
                {news.map((n) => (
                  <article key={n.id} className="mc-news__card mc-news__card--news">
                    <span className="mc-news__stripe" style={{ background: `linear-gradient(120deg, ${n.gradient[0]}, ${n.gradient[1]})` }} />
                    <span className="col grow" style={{ gap: 6, minWidth: 0 }}>
                      <span className="tiny muted">{`${n.category} · ${fmtDate(n.date)}`}</span>
                      <span className="mc-news__title" data-i18n-skip>
                        {n.title}
                      </span>
                      <span className="small soft mc-news__summary" data-i18n-skip>
                        {n.summary}
                      </span>
                      <span>
                        <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => api.shell.openExternal(n.url)}>
                          Читать на minecraft.net
                        </Button>
                      </span>
                    </span>
                  </article>
                ))}
              </div>
            )}
            <p className="tiny muted">Источник — официальная лента Mojang (та же, что в официальном лаунчере). Тексты новостей — на английском, заметки к обновлениям можно перевести.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function PatchNoteView({ item, onBack }: { item: PatchNoteItem; onBack: () => void }) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const [note, setNote] = useState<PatchNote | null>(null);
  const [error, setError] = useState('');
  const [translated, setTranslated] = useState<{ summary: string; body: string; truncated: boolean } | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const lang = settings?.general.language ?? 'ru';

  useEffect(() => {
    setNote(null);
    setTranslated(null);
    setShowTranslated(false);
    void api
      .invoke<PatchNote>('news:patchNote', item.id)
      .then(setNote)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [item.id]);

  const translate = async () => {
    if (!note) return;
    if (translated) {
      setShowTranslated(!showTranslated);
      return;
    }
    setTranslating(true);
    try {
      const page = await api.invoke<{ summary: string; body: string; truncated: boolean }>('translate:page', note.title, note.body, lang);
      setTranslated(page);
      setShowTranslated(true);
    } catch (e) {
      toast('error', 'Не удалось перевести', e instanceof Error ? e.message : String(e));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <article className="mc-news__article">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>
          Все новости
        </Button>
        <span className="grow" />
        {lang !== 'en' && (
          <Button variant="secondary" size="sm" icon={<Languages size={14} />} loading={translating} disabled={!note} onClick={translate}>
            {showTranslated ? 'Оригинал' : 'Перевести'}
          </Button>
        )}
        <Button size="sm" icon={<Plus size={14} />} onClick={() => createInstanceFor(item.version)}>
          {`Создать сборку на ${item.version}`}
        </Button>
      </div>
      <h1 className="guide-article__title" data-i18n-skip>
        {showTranslated && translated ? translated.summary : item.title}
      </h1>
      <span className="tiny muted">{`${item.type === 'release' ? 'Релиз' : 'Снапшот'} · ${fmtDate(item.date)}`}</span>
      {item.type === 'snapshot' && (
        <div className="guide-note">Снапшоты — тестовые версии: играйте в отдельной сборке, миры на них могут сломаться, а моды почти никогда не выходят.</div>
      )}
      {error ? (
        <p className="small muted">{error}</p>
      ) : !note ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : (
        <Markdown text={showTranslated && translated ? translated.body : note.body} />
      )}
      {showTranslated && translated?.truncated && (
        <p className="tiny muted">Длинный текст переведён частично — конец оставлен в оригинале. Без лимитов переводит ИИ (Настройки → ИИ-помощник).</p>
      )}
    </article>
  );
}
