import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Settings2, X } from 'lucide-react';
import { api } from '../api';
import { Modal } from './Overlay';
import { Button } from './Button';
import { ProgressBar } from './Controls';
import { fmtDuration, fmtSpeed } from '../i18n';
import type { DownloadTask } from '../../shared/types';

interface Stats {
  bytesDone: number;
  bytesTotal: number;
  speedBps: number;
  etaSeconds: number | null;
  running: number;
  queued: number;
}

function speed(value?: number) {
  if (!value) return '';
  return fmtSpeed(value);
}

function eta(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  return fmtDuration(seconds);
}

/** Компактный индикатор загрузок в сайдбаре + панель управления. */
export function DownloadsIndicator() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void api.invoke<DownloadTask[]>('downloads:list').then(setTasks);
    const off = api.on('downloads:changed', (list) => setTasks(list as DownloadTask[]));
    const timer = setInterval(() => {
      void api.invoke<Stats>('downloads:stats').then(setStats).catch(() => undefined);
    }, 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'paused');

  const percent = (task: DownloadTask) =>
    task.bytesTotal ? Math.round(((task.bytesDone ?? 0) / task.bytesTotal) * 100) : task.total ? Math.round((task.done / task.total) * 100) : 0;

  // Общий процент: по байтам, если они известны, иначе среднее по задачам.
  // Пока загрузки идут, процент только растёт — новые подзадачи (Java, ассеты)
  // не отбрасывают его назад.
  const rawTotal = stats?.bytesTotal
    ? Math.round((stats.bytesDone / stats.bytesTotal) * 100)
    : active.length
      ? Math.round(active.reduce((n, t) => n + percent(t), 0) / active.length)
      : 0;
  const peak = useRef(0);
  if (!active.length) peak.current = 0;
  else peak.current = Math.max(peak.current, Math.min(100, rawTotal));
  const total = peak.current;

  if (!active.length && !open) return null;
  const main = active.find((t) => t.status === 'running') ?? active[0];
  const paused = active.length > 0 && active.every((t) => t.status === 'paused');

  return (
    <>
      {main && (
        <div className="dl-list">
          <button className="dl-card" onClick={() => setOpen(true)}>
            <div className="row" style={{ gap: 6 }}>
              <span className="dl-title truncate">{main.title}</span>
              <span className="dl-percent">{`${total}%`}</span>
            </div>
            <div className="dl-detail truncate">
              {paused
                ? 'пауза'
                : !stats?.speedBps
                  ? 'Подготовка…'
                  : stats.etaSeconds
                    ? `${speed(stats.speedBps)} · осталось ${eta(stats.etaSeconds)}`
                    : speed(stats.speedBps)}
            </div>
            <ProgressBar value={total} />
          </button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title="Загрузки"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings2 size={14} />}
              onClick={() => {
                setOpen(false);
                window.location.hash = '/settings?tab=downloads';
              }}
            >
              Настройки загрузок
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Закрыть
            </Button>
          </>
        }
      >
        <div className="dl-summary">
          <span>
            Скорость: <strong>{fmtSpeed(stats?.speedBps ?? 0)}</strong>
          </span>
          <span className="muted">·</span>
          <span>{`Осталось: ${eta(stats?.etaSeconds) || '—'}`}</span>
          <span className="muted">·</span>
          <span>{`Активных: ${stats?.running ?? active.filter((t) => t.status === 'running').length} · в очереди: ${stats?.queued ?? active.filter((t) => t.status === 'queued').length}`}</span>
        </div>

        <div className="dl-tasks">
          {tasks.length === 0 && <p className="small muted">Активных загрузок нет.</p>}
          {tasks.map((task) => (
            <div className="dl-task" key={task.id} data-status={task.status}>
              <div className="row" style={{ gap: 8 }}>
                <span className="grow truncate" style={{ fontWeight: 600 }}>{task.title}</span>
                <span className="tiny muted">{percent(task)}%</span>
              </div>
              <div className="tiny muted truncate">
                {task.detail ?? ''}
                {task.status === 'paused' ? ' · пауза' : task.speedBps ? ` · ${speed(task.speedBps)}` : ''}
                {task.etaSeconds ? ` · осталось ${eta(task.etaSeconds)}` : ''}
                {task.error ? ` · ${task.error}` : ''}
              </div>
              <ProgressBar value={percent(task)} loading={task.status === 'queued'} />
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {task.status === 'paused' ? (
                  <Button size="sm" variant="secondary" icon={<Play size={13} />} onClick={() => api.invoke('downloads:resume', task.id)}>
                    Продолжить
                  </Button>
                ) : task.status === 'running' || task.status === 'queued' ? (
                  <Button size="sm" variant="secondary" icon={<Pause size={13} />} onClick={() => api.invoke('downloads:pause', task.id)}>
                    Пауза
                  </Button>
                ) : null}
                {task.status !== 'done' && task.status !== 'error' && (
                  <Button size="sm" variant="neutral" icon={<X size={13} />} onClick={() => api.invoke('downloads:cancel', task.id)}>
                    Отменить
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}