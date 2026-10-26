import { useEffect, useState } from 'react';
import { ArrowRightLeft, FolderOpen, HardDrive, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Checkbox, ProgressBar } from '../../ui/Controls';
import { Modal } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { fmtBytes } from '../../i18n';
import { Row, Section } from './parts';

interface Drive {
  path: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
}

interface MoveProgress {
  copiedBytes: number;
  totalBytes: number;
  copiedFiles: number;
  totalFiles: number;
  file: string;
}

/** Куда качать: текущая папка данных, диски и перенос со старым содержимым. */
export function StorageSection({ root }: { root: string }) {
  const { toast } = useToast();
  const [drives, setDrives] = useState<Drive[]>([]);
  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [deleteOld, setDeleteOld] = useState(true);
  const [moving, setMoving] = useState(false);
  const [progress, setProgress] = useState<MoveProgress | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => {
    void api.invoke<Drive[]>('paths:drives').then(setDrives).catch(() => setDrives([]));
    void api
      .invoke<{ bytes: number; files: number }>('paths:usage')
      .then(setUsage)
      .catch(() => setUsage(null));
  };

  useEffect(() => {
    refresh();
    const off = api.on('paths:moveProgress', (p) => setProgress(p as MoveProgress));
    return () => off();
  }, []);

  const isCurrent = (drive: Drive) => root.toLowerCase().startsWith(drive.path.toLowerCase());

  const pickFolder = async () => {
    const folder = await api.dialog.folder('Куда перенести папку данных Ploxel');
    if (folder) setTarget(folder);
  };

  const start = async () => {
    if (!target) return;
    setMoving(true);
    setProgress(null);
    try {
      const result = await api.invoke<{ root: string; deletedOld: boolean }>(
        'paths:moveRoot',
        target,
        deleteOld
      );
      setDone(result.root);
      setTarget(null);
      refresh();
      toast(
        'success',
        'Данные перенесены',
        result.deletedOld ? 'Старая папка удалена.' : 'Старые файлы остались на прежнем месте.'
      );
    } catch (e) {
      toast('error', 'Не удалось перенести данные', e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(false);
      setProgress(null);
    }
  };

  const freeAtTarget = (() => {
    if (!target) return null;
    const drive = drives.find((d) => target.toLowerCase().startsWith(d.path.toLowerCase()));
    return drive ? drive.freeBytes : null;
  })();

  return (
    <>
      <Section
        title="Куда скачивать"
        hint="Сборки, версии игры, ассеты и Java занимают десятки гигабайт. Если на диске C мало места — перенесите папку данных на другой диск."
      >
        <Row label="Текущая папка данных" stack>
          <div className="storage-path">
            <span className="storage-path__icon">
              <HardDrive size={16} />
            </span>
            <code className="mono small storage-path__value" title={root}>{root}</code>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <Button variant="neutral" size="sm" icon={<FolderOpen size={15} />} onClick={() => api.shell.openPath(root)}>
              Открыть
            </Button>
            <Button variant="secondary" size="sm" icon={<ArrowRightLeft size={15} />} onClick={pickFolder}>
              Выбрать другую папку
            </Button>
            <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh}>
              Обновить
            </Button>
            {usage && (
              <span className="tiny muted">
                {`Занято ${fmtBytes(usage.bytes)} · файлов: ${usage.files}`}
              </span>
            )}
          </div>
        </Row>
        <Row label="Быстрый выбор диска" hint="Выберите диск — данные перенесутся в папку Ploxel на нём." stack>
          <div className="col" style={{ gap: 8, width: '100%' }}>
            <div className="drive-grid">
              {drives.map((drive) => (
                <button
                  key={drive.path}
                  className="drive-card"
                  data-current={isCurrent(drive) ? 'true' : undefined}
                  disabled={moving || isCurrent(drive)}
                  onClick={() => setTarget(`${drive.path}Ploxel`)}
                >
                  <span className="drive-card__name">{drive.label}</span>
                  <span className="tiny muted">
                    {`Свободно ${fmtBytes(drive.freeBytes)} из ${fmtBytes(drive.totalBytes)}`}
                  </span>
                  {isCurrent(drive) && <span className="chip chip--accent">текущая папка</span>}
                </button>
              ))}
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              Перенос копирует все сборки и скачанные версии, а затем переключает лаунчер на новое место. Игру во
              время переноса лучше закрыть.
            </p>
          </div>
        </Row>
        {done && (
          <Row label="Новая папка активна" stack>
            <div className="row wrap" style={{ gap: 8 }}>
              <code className="mono small storage-path__value">{done}</code>
              <Button size="sm" onClick={() => api.invoke('app:relaunch')}>
                Перезапустить лаунчер
              </Button>
            </div>
            <span className="tiny muted">
              Перезапуск нужен, чтобы все разделы увидели новый путь. Загрузки и сборки уже на новом месте.
            </span>
          </Row>
        )}
      </Section>

      <Modal
        open={!!target}
        onClose={() => !moving && setTarget(null)}
        title="Перенести папку данных?"
        actions={
          <>
            <Button variant="secondary" disabled={moving} onClick={() => setTarget(null)}>
              Отмена
            </Button>
            <Button onClick={start} loading={moving} disabled={!target} icon={<ArrowRightLeft size={15} />}>
              Перенести
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <div className="storage-path">
            <ArrowRightLeft size={16} />
            <code className="mono small storage-path__value">{target}</code>
          </div>
          <p className="small" style={{ margin: 0 }}>
            {usage
              ? `Будет скопировано ${fmtBytes(usage.bytes)} (${usage.files} файлов).`
              : 'Будут скопированы все сборки, версии игры, библиотеки и Java.'}
            {freeAtTarget !== null && ` На диске свободно ${fmtBytes(freeAtTarget)}.`}
          </p>
          <Checkbox
            checked={deleteOld}
            onChange={setDeleteOld}
            label="Удалить файлы в старой папке после переноса"
          />
          <span className="small" style={{ marginTop: -6 }}>
            {deleteOld
              ? 'Старая папка освободит место, но восстанавливать данные будет неоткуда. Удаление начнётся только после успешного копирования.'
              : 'Старые файлы останутся на прежнем месте как резервная копия — их можно удалить вручную.'}
          </span>
          {moving && (
            <div className="col" style={{ gap: 6 }}>
              <ProgressBar
                value={progress?.copiedBytes ?? 0}
                max={progress?.totalBytes || 1}
                label={progress ? fmtBytes(progress.copiedBytes) : ''}
              />
              <span className="tiny muted">
                {progress
                  ? `Файлов: ${progress.copiedFiles} из ${progress.totalFiles}${progress.file ? ` · ${progress.file}` : ''}`
                  : 'Готовим перенос…'}
              </span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void api.invoke('paths:cancelMove')}
                style={{ alignSelf: 'flex-start' }}
              >
                Отменить перенос
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}