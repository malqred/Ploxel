import { useCallback, useEffect, useState } from 'react';
import { Camera, Download, FolderOpen, Globe2, Server, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Common';
import { ImageViewer } from '../../ui/ImageViewer';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { fmtDate, fmtTime } from '../../i18n';
import type { ScreenshotInfo } from '../../../shared/types';

export function screenshotUrl(instanceId: string, file: string): string {
  return `ploxel-media://shot/${encodeURIComponent(instanceId)}/${encodeURIComponent(file)}`;
}

function WorldLabel({ shot }: { shot: ScreenshotInfo }) {
  if (!shot.world) return <span className="tiny muted">Мир не определён</span>;
  return (
    <span className="tiny muted row truncate" style={{ gap: 4 }} title={shot.guessed ? 'Мир угадан по времени снимка' : undefined}>
      {shot.server ? <Server size={12} /> : <Globe2 size={12} />}
      <span className="truncate" data-i18n-skip>{shot.world}</span>
      {shot.guessed && <span>(по времени)</span>}
    </span>
  );
}

/** Снимки экрана сборки: когда и в каком мире сделаны, просмотр и сохранение. */
export function ScreenshotsTab({ instanceId, onCount }: { instanceId: string; onCount?: (n: number) => void }) {
  const [shots, setShots] = useState<ScreenshotInfo[] | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<ScreenshotInfo | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const list = await api.invoke<ScreenshotInfo[]>('screenshots:list', instanceId).catch(() => []);
    setShots(list);
    onCount?.(list.length);
  }, [instanceId, onCount]);

  useEffect(() => {
    void load();
    const off = api.on('game:exited', () => void load());
    return off;
  }, [load]);

  const saveAs = async (shot: ScreenshotInfo) => {
    try {
      const saved = await api.invoke<string | null>('screenshots:saveAs', instanceId, shot.file);
      if (saved) toast('success', 'Снимок сохранён', saved);
    } catch (e) {
      toast('error', 'Не удалось сохранить', e instanceof Error ? e.message : String(e));
    }
  };

  if (!shots) {
    return (
      <div className="shots-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ aspectRatio: '16 / 10' }} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="instance-toolbar">
        <span className="small muted grow">
          Снимки делаются в игре клавишей F2. Мир отмечается сам, если игра запущена из Ploxel.
        </span>
        <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => api.invoke('instances:folder', instanceId, 'screenshots')}>
          Папка снимков
        </Button>
      </div>
      {shots.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Camera size={24} />}
            title="Снимков пока нет"
            hint="Нажмите F2 в игре — снимок появится здесь вместе с датой и названием мира."
          />
        </div>
      ) : (
        <div className="shots-grid">
          {shots.map((shot, idx) => (
            <article key={shot.file} className="card shot-card">
              <button className="shot-card__image" onClick={() => setViewing(idx)} title="Открыть снимок">
                <img src={screenshotUrl(instanceId, shot.file)} alt="" loading="lazy" draggable={false} />
              </button>
              <div className="shot-card__body">
                <span className="col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 600 }}>{`${fmtDate(shot.takenAt)}, ${fmtTime(shot.takenAt)}`}</span>
                  <WorldLabel shot={shot} />
                </span>
                <span className="row" style={{ gap: 2 }}>
                  <button className="icon-btn icon-btn--sm icon-btn--ghost" title="Сохранить как…" aria-label="Сохранить как…" onClick={() => void saveAs(shot)}>
                    <Download size={14} />
                  </button>
                  <button className="icon-btn icon-btn--sm icon-btn--ghost" title="Удалить снимок" aria-label="Удалить снимок" onClick={() => setToDelete(shot)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      <ImageViewer
        images={shots.map((s) => ({
          src: screenshotUrl(instanceId, s.file),
          caption: (
            <>
              <span style={{ fontWeight: 600 }}>{`${fmtDate(s.takenAt)}, ${fmtTime(s.takenAt)}`}</span>
              <WorldLabel shot={s} />
            </>
          )
        }))}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        actions={(_img, i) => (
          <>
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => api.invoke('screenshots:show', instanceId, shots[i].file)}>
              Показать в папке
            </Button>
            <Button size="sm" icon={<Download size={14} />} onClick={() => void saveAs(shots[i])}>
              Сохранить как…
            </Button>
          </>
        )}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Удалить снимок?"
        confirmLabel="Удалить"
        danger
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const shot = toDelete;
          setToDelete(null);
          if (!shot) return;
          await api.invoke('screenshots:delete', instanceId, shot.file).catch(() => undefined);
          setViewing(null);
          void load();
        }}
      >
        <p>Снимок переместится в корзину Windows — его можно будет восстановить.</p>
      </ConfirmDialog>
    </>
  );
}
