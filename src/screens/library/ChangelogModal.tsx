import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Common';
import { Markdown } from '../../ui/Markdown';
import { Modal } from '../../ui/Overlay';
import { fmtDate } from '../../i18n';
import type { CatalogVersion, ChangelogEntry, InstalledMod } from '../../../shared/types';

/**
 * «Что нового» перед обновлением: изменения всех версий между установленной
 * и новой. Обновление — кнопкой в этом же окне.
 */
export function ChangelogModal({
  instanceId,
  mod,
  next,
  busy,
  onClose,
  onUpdate
}: {
  instanceId: string;
  mod: InstalledMod | null;
  next: CatalogVersion | undefined;
  busy: boolean;
  onClose: () => void;
  onUpdate: (mod: InstalledMod) => void;
}) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mod) return;
    let cancelled = false;
    setEntries(null);
    setError('');
    api
      .invoke<ChangelogEntry[]>('mods:changelog', instanceId, mod.id)
      .then((list) => !cancelled && setEntries(list))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [instanceId, mod?.id]);

  const written = entries?.filter((e) => e.changelog) ?? [];

  return (
    <Modal
      open={!!mod}
      onClose={onClose}
      wide
      title={mod ? `${mod.name}: что нового` : ''}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          {mod && next && (
            <Button variant="purple" icon={<Download size={15} />} loading={busy} onClick={() => onUpdate(mod)}>{`Обновить до ${next.versionNumber}`}</Button>
          )}
        </>
      }
    >
      {mod && (
        <p className="small muted" style={{ marginTop: 0 }}>{`Установлена версия ${mod.version}. Ниже — изменения в более новых версиях, свежие сверху.`}</p>
      )}
      {error ? (
        <EmptyState icon={<FileText size={22} />} title="Не удалось загрузить изменения" hint={error} />
      ) : !entries ? (
        <div className="col" style={{ gap: 10 }}>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton" style={{ height: 80 }} />
          ))}
        </div>
      ) : written.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title="Автор не описал изменения"
          hint={entries.length ? `Новых версий: ${entries.length}. Подробности — на странице мода.` : 'Новых версий под эту сборку не нашлось.'}
        />
      ) : (
        <div className="changelog-list">
          {entries.map((entry) => (
            <section key={entry.versionId} className="changelog-entry">
              <div className="row changelog-entry__head">
                <span className="changelog-entry__version" data-i18n-skip>
                  {entry.versionNumber}
                </span>
                <span className="tiny muted">{fmtDate(entry.datePublished)}</span>
              </div>
              {entry.changelog ? (
                <div className="changelog-entry__body" data-i18n-skip>
                  <Markdown text={entry.changelog} />
                </div>
              ) : (
                <p className="small muted">Автор не описал изменения в этой версии.</p>
              )}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
