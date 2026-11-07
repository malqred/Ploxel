import { useEffect, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, Loader2 } from 'lucide-react';
import { api } from '../api';
import { Modal } from './Overlay';
import { Button } from './Button';
import { useToast } from '../state/toast';
import type { ManualFile } from '../../shared/types';

type Status = ManualFile & { done: boolean };

/** Открыть окно «Скачайте с сайта» из любого места интерфейса. */
export function requestManualDownloads(files: ManualFile[]) {
  if (files.length) window.dispatchEvent(new CustomEvent('ploxel:manual', { detail: files }));
}

/**
 * Файлы, которые автор разрешил скачивать только с сайта CurseForge.
 * «Скачать» открывает страницу файла в браузере; лаунчер сам находит скачанный
 * файл в «Загрузках» и кладёт его в сборку.
 */
export function ManualDownloadsHost() {
  const [items, setItems] = useState<Status[]>([]);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const onRequest = (e: Event) => {
      const files = (e as CustomEvent<ManualFile[]>).detail;
      void api.invoke<Status[]>('manual:watch', files).then((list) => {
        const wanted = new Set(files.map((f) => f.fileName));
        setItems(list.filter((s) => wanted.has(s.fileName)));
        setOpen(true);
      });
    };
    window.addEventListener('ploxel:manual', onRequest);
    const off = api.on('manual:status', (p) => {
      const s = p as { fileName: string; instanceId: string; title: string };
      setItems((cur) => cur.map((i) => (i.fileName === s.fileName && i.instanceId === s.instanceId ? { ...i, done: true } : i)));
      toast('success', `${s.title} добавлен`, 'Файл найден в «Загрузках» и положен в сборку.');
    });
    return () => {
      window.removeEventListener('ploxel:manual', onRequest);
      off();
    };
  }, [toast]);

  const left = items.filter((i) => !i.done).length;

  const pick = async (item: Status) => {
    try {
      const res = await api.invoke<Status | null>('manual:pick', item.instanceId, item.fileName);
      if (res) setItems((cur) => cur.map((i) => (i.fileName === item.fileName ? { ...i, done: true } : i)));
    } catch (e) {
      toast('error', 'Не тот файл', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Скачайте с сайта CurseForge"
      actions={
        <Button variant={left ? 'secondary' : 'primary'} onClick={() => setOpen(false)}>
          {left ? 'Скачаю позже' : 'Готово'}
        </Button>
      }
    >
      <p className="small soft" style={{ marginTop: 0 }}>
        Автор этих файлов разрешил скачивать их только с сайта. Нажмите «Скачать» — откроется страница, и браузер
        скачает файл в «Загрузки». Лаунчер сам найдёт его и положит в сборку — ничего переносить не нужно.
      </p>
      <div className="col" style={{ gap: 8 }}>
        {items.map((item) => (
          <div key={item.fileName} className="row panel" style={{ gap: 10, padding: '10px 12px' }}>
            {item.done ? <CheckCircle2 size={18} style={{ color: 'var(--success)', flexShrink: 0 }} /> : <Loader2 size={18} className="spin muted" style={{ flexShrink: 0 }} />}
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 600 }}>{item.title}</div>
              <div className="tiny muted truncate">{item.done ? 'В сборке' : `Ждём файл ${item.fileName}`}</div>
            </div>
            {!item.done && (
              <>
                <Button size="sm" icon={<Download size={14} />} onClick={() => void api.shell.openExternal(item.pageUrl)}>
                  Скачать
                </Button>
                <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void pick(item)}>
                  Указать файл
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Установка упала, потому что автор запретил скачивание через лаунчеры: предлагаем
 * скачать файл с сайта (окно выше). true — окно открыто, ошибку показывать не нужно.
 */
export async function offerManualDownload(
  error: unknown,
  instanceId: string,
  source: 'modrinth' | 'curseforge',
  projectId: string,
  kind: ManualFile['kind'],
  versionId?: string
): Promise<boolean> {
  const text = error instanceof Error ? error.message : String(error);
  if (source !== 'curseforge' || !text.includes('запретил скачивание')) return false;
  const file = await api.invoke<ManualFile | null>('manual:forProject', instanceId, source, projectId, kind, versionId).catch(() => null);
  if (!file) return false;
  requestManualDownloads([file]);
  return true;
}
