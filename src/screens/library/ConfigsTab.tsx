import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileCog, FolderOpen, RotateCcw, Save } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Common';
import { SearchField } from '../../ui/TextField';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { fmtBytes, fmtRelative } from '../../i18n';
import type { ConfigFileInfo } from '../../../shared/types';

interface OpenFile {
  path: string;
  original: string;
  text: string;
  modifiedAt: string;
}

/**
 * Редактор настроек модов: список файлов из config/, defaultconfigs/ и
 * options.txt, текст справа. Перед сохранением JSON и TOML проверяются,
 * прошлая версия файла уходит в backups/configs сборки.
 */
export function ConfigsTab({ instanceId, running }: { instanceId: string; running: boolean }) {
  const [files, setFiles] = useState<ConfigFileInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const { toast } = useToast();

  const reload = useCallback(() => {
    void api
      .invoke<ConfigFileInfo[]>('configs:list', instanceId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [instanceId]);

  useEffect(reload, [reload]);

  const dirty = !!open && open.text !== open.original;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = files ?? [];
    return q ? list.filter((f) => f.path.toLowerCase().includes(q)) : list;
  }, [files, query]);

  const load = async (path: string) => {
    try {
      const res = await api.invoke<{ text: string; modifiedAt: string }>('configs:read', instanceId, path);
      setOpen({ path, original: res.text, text: res.text, modifiedAt: res.modifiedAt });
      setProblem('');
    } catch (e) {
      toast('error', 'Не удалось открыть файл', e instanceof Error ? e.message : String(e));
    }
  };

  // Несохранённые правки не теряются молча при выборе другого файла
  const choose = (path: string) => {
    if (open?.path === path) return;
    if (dirty) setPending(path);
    else void load(path);
  };

  const save = async (force = false) => {
    if (!open) return;
    setSaving(true);
    try {
      const res = await api.invoke<{ modifiedAt?: string; problem?: string }>(
        'configs:write',
        instanceId,
        open.path,
        open.text,
        open.modifiedAt,
        force
      );
      if (res.problem) {
        setProblem(res.problem);
        return;
      }
      setOpen({ ...open, original: open.text, modifiedAt: res.modifiedAt ?? open.modifiedAt });
      setProblem('');
      toast('success', 'Файл сохранён', 'Прошлая версия лежит в папке backups/configs сборки.');
      reload();
    } catch (e) {
      toast('error', 'Не удалось сохранить', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) void save();
    }
  };

  if (files && files.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={<FileCog size={24} />}
          title="Файлов настроек пока нет"
          hint="Моды создают их в папке config при первом запуске игры. Запустите сборку один раз — и они появятся здесь."
        />
      </div>
    );
  }

  return (
    <div className="configs">
      <aside className="configs__list panel">
        <SearchField value={query} onChange={setQuery} placeholder="Найти файл…" />
        <div className="configs__files">
          {!files
            ? [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 34 }} />)
            : shown.map((f) => (
                <button
                  key={f.path}
                  className="configs__file"
                  aria-selected={open?.path === f.path}
                  title={`${f.path} · ${fmtBytes(f.sizeBytes)}`}
                  onClick={() => choose(f.path)}
                >
                  <span className="truncate" data-i18n-skip>
                    {f.path.split('/').pop()}
                  </span>
                  <span className="tiny muted truncate" data-i18n-skip>
                    {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}
                  </span>
                </button>
              ))}
        </div>
      </aside>

      <section className="configs__editor panel">
        {!open ? (
          <EmptyState
            icon={<FileCog size={24} />}
            title="Выберите файл слева"
            hint="Здесь настраиваются моды: дальность, клавиши, включение функций. Если не уверены, что делает строка, лучше не менять."
          />
        ) : (
          <>
            <div className="row configs__head">
              <div className="col configs__title">
                <span className="configs__name truncate" data-i18n-skip>
                  {open.path}
                </span>
                <span className="tiny muted">{dirty ? 'Есть несохранённые изменения' : `Изменён ${fmtRelative(open.modifiedAt)}`}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<FolderOpen size={14} />}
                onClick={() => api.invoke('configs:reveal', instanceId, open.path)}
              >
                Показать в папке
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw size={14} />}
                disabled={!dirty}
                onClick={() => {
                  setOpen({ ...open, text: open.original });
                  setProblem('');
                }}
              >
                Отменить правки
              </Button>
              <Button size="sm" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={() => save()}>
                Сохранить
              </Button>
            </div>
            {running && (
              <div className="notice">
                <AlertTriangle size={14} />
                <div>Игра запущена: многие моды перечитывают настройки только при запуске и при выходе могут перезаписать файл.</div>
              </div>
            )}
            {problem && (
              <div className="notice notice--danger row" style={{ gap: 10 }}>
                <AlertTriangle size={14} />
                <span className="grow">{`В файле ошибка: ${problem}`}</span>
                <Button size="sm" variant="secondary" onClick={() => save(true)}>
                  Сохранить всё равно
                </Button>
              </div>
            )}
            <textarea
              className="configs__text"
              value={open.text}
              spellCheck={false}
              onChange={(e) => {
                setOpen({ ...open, text: e.target.value });
                setProblem('');
              }}
              onKeyDown={onKey}
              data-i18n-skip
            />
          </>
        )}
      </section>

      <ConfirmDialog
        open={!!pending}
        title="Не сохранять изменения?"
        confirmLabel="Не сохранять"
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const next = pending;
          setPending(null);
          if (next) void load(next);
        }}
      >
        В открытом файле есть несохранённые правки. Если открыть другой файл, они пропадут.
      </ConfirmDialog>
    </div>
  );
}
