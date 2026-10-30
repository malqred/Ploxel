import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { CheckCircle2, Download, FolderSearch, Import, RefreshCw, Upload } from 'lucide-react';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Controls';
import { ScreenHeader, EmptyState } from '../ui/Common';
import { Modal } from '../ui/Overlay';
import { useToast } from '../state/toast';
import { fmtBytes } from '../i18n';
import type {
  ImportOptions,
  ImportResult,
  ImportedInstanceInfo,
  LauncherDetection
} from '../../shared/types';

const DEFAULT_OPTIONS: ImportOptions = {
  mode: 'copy',
  worlds: true,
  settings: true,
  servers: true,
  jvm: true,
  memory: true
};

export function ImportScreen() {
  const [launchers, setLaunchers] = useState<LauncherDetection[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  // Предложить удалить перенесённые сборки в старом лаунчере (спросим ещё раз в конце)
  const [offerDelete, setOfferDelete] = useState(false);
  const [toDelete, setToDelete] = useState<ImportResult[]>([]);
  const [deleteChecked, setDeleteChecked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const detect = async (extraPaths?: string[]) => {
    setLaunchers(null);
    try {
      const list = await api.invoke<LauncherDetection[]>('import:detect', extraPaths);
      setLaunchers(list);
    } catch (e) {
      setLaunchers([]);
      toast('error', 'Не удалось найти лаунчеры', e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void detect();
  }, []);

  const allInstances = useMemo(
    () => (launchers ?? []).flatMap((l) => l.instances),
    [launchers]
  );

  const toggle = (path: string, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const toggleLauncher = (launcher: LauncherDetection, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const inst of launcher.instances) {
        if (value) next.add(inst.path);
        else next.delete(inst.path);
      }
      return next;
    });
  };

  const runImport = async () => {
    const chosen = allInstances.filter((i) => selected.has(i.path));
    if (!chosen.length) return;
    setBusy(true);
    setLog([]);
    const results: ImportResult[] = [];
    for (const info of chosen) {
      try {
        const res = await api.invoke<ImportResult>('import:run', info, options);
        results.push(res);
        setLog((prev) => [...prev, `✓ ${res.name}: модов ${res.importedMods}, миров ${res.importedWorlds}`]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLog((prev) => [...prev, `✗ ${info.name}: ${msg}`]);
      }
    }
    setBusy(false);
    const ok = results.length;
    toast(ok ? 'success' : 'error', ok ? `Импортировано сборок: ${ok}` : 'Импорт не удался', ok ? 'Откройте «Сборки», чтобы проверить.' : undefined);
    setSelected(new Set());
    const deletable = results.filter((r) => r.sourceDeletable && r.sourcePath);
    if (offerDelete && deletable.length) {
      setToDelete(deletable);
      setDeleteChecked(new Set(deletable.map((r) => r.sourcePath!)));
    }
    await detect();
  };

  const deleteSources = async () => {
    setDeleting(true);
    let done = 0;
    const failed: string[] = [];
    for (const r of toDelete.filter((x) => deleteChecked.has(x.sourcePath!))) {
      try {
        await api.invoke('import:deleteSource', r.sourcePath);
        done++;
      } catch (e) {
        failed.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setDeleting(false);
    setToDelete([]);
    if (done) toast('success', `Удалено в старых лаунчерах: ${done}`, 'Папки перемещены в корзину Windows.');
    if (failed.length) toast('error', 'Не всё удалось удалить', failed.join('; '));
    await detect();
  };

  const importFile = async (file?: string) => {
    setBusy(true);
    try {
      const instance = await api.invoke<{ id: string; name: string } | null>('import:archive', file, options);
      if (instance) {
        toast('success', 'Модпак импортирован', instance.name);
        window.location.hash = `/library?instance=${instance.id}`;
      }
    } catch (e) {
      toast('error', 'Импорт не удался', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const dir = await api.dialog.folder('Укажите папку другого лаунчера');
    if (!dir) return;
    await detect([dir]);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const filePath = window.ploxel.getPathForFile?.(file);
    if (!filePath) {
      toast('warning', 'Перетаскивание недоступно', 'Нажмите «Импорт из файла».');
      return;
    }
    await importFile(filePath);
  };

  return (
    <div
      className={`screen import-screen ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <ScreenHeader
        title="Импорт"
        sub="Найдём сборки в других лаунчерах. Оригиналы не меняются; удалить их можно только по вашему выбору."
        actions={
          <>
            <Button variant="secondary" icon={<FolderSearch size={15} />} onClick={pickFolder}>
              Указать папку
            </Button>
            <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => detect()}>
              Найти заново
            </Button>
            <Button icon={<Upload size={15} />} onClick={() => importFile()} loading={busy}>
              Импорт из файла
            </Button>
          </>
        }
      />

      {busy && <p className="small muted">Идёт импорт, не закрывайте лаунчер…</p>}
      {dragging && <div className="import-drop">Отпустите архив .mrpack или .zip</div>}

      {options && (
        <div className="panel import-options">
          <span className="field__label">Режим</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="chip chip--button"
              data-active={options.mode === 'copy'}
              onClick={() => setOptions({ ...options, mode: 'copy' })}
            >
              Копировать файлы (по умолчанию)
            </button>
            <button
              className="chip chip--button"
              data-active={options.mode === 'link'}
              onClick={() => setOptions({ ...options, mode: 'link' })}
            >
              Ссылки (экономит место)
            </button>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            {(
              [
                ['worlds', 'Миры'],
                ['settings', 'Настройки игры'],
                ['servers', 'Список серверов'],
                ['jvm', 'Аргументы JVM'],
                ['memory', 'Память']
              ] as const
            ).map(([key, label]) => (
              <span className="row" key={key} style={{ gap: 6 }}>
                <Checkbox checked={options[key]} onChange={(v) => setOptions({ ...options, [key]: v })} label={label} />
                <span className="small">{label}</span>
              </span>
            ))}
          </div>
          <label className="row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
            <Checkbox checked={offerDelete} onChange={setOfferDelete} label="Предложить удалить сборки в старом лаунчере" />
            <span className="col" style={{ gap: 2 }}>
              <span className="small">Предложить удалить сборки в старом лаунчере</span>
              <span className="tiny muted">
                После переноса лаунчер ещё раз спросит, какие сборки убрать. Папки уйдут в корзину Windows. Общая папка
                .minecraft официального лаунчера и TLauncher не удаляется.
              </span>
            </span>
          </label>
          <span className="tiny muted">
            Аккаунты и токены не импортируются никогда. Режим ссылок может не сработать на другом диске — тогда
            файлы копируются.
          </span>
        </div>
      )}

      <p className="tiny muted">
        Ищем сборки: официальный лаунчер, TLauncher, SKLauncher, Legacy Launcher, HMCL, Prism Launcher, PolyMC, MultiMC,
        ATLauncher, GDLauncher, CurseForge, Modrinth App, X Minecraft Launcher, 16Launcher, FTB App и Technic. Если
        лаунчер хранит сборки в другом месте — укажите папку вручную.
      </p>

      {launchers === null ? (
        <div className="col" style={{ gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 120 }} />
          ))}
        </div>
      ) : launchers.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Download size={26} />}
            title="Другие лаунчеры не найдены"
            hint="Можно указать папку вручную или импортировать модпак из файла .mrpack / zip."
          />
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {launchers.map((launcher) => {
            const selectedHere = launcher.instances.filter((i) => selected.has(i.path)).length;
            return (
              <section className="panel import-launcher" key={launcher.path}>
                <div className="row" style={{ gap: 10 }}>
                  <Checkbox
                    checked={selectedHere === launcher.instances.length && launcher.instances.length > 0}
                    indeterminate={selectedHere > 0 && selectedHere < launcher.instances.length}
                    onChange={(v) => toggleLauncher(launcher, v)}
                    label={launcher.name}
                  />
                  <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 650 }}>{launcher.name}</span>
                    <span className="tiny muted truncate">{launcher.path}</span>
                  </div>
                  <span className="chip">{`Сборок: ${launcher.instances.length}`}</span>
                  <span className="chip">{fmtBytes(launcher.totalSize)}</span>
                </div>
                <div className="import-list">
                  {launcher.instances.map((inst) => (
                    <ImportRow
                      key={inst.path}
                      inst={inst}
                      checked={selected.has(inst.path)}
                      onChange={(v) => toggle(inst.path, v)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <div className="row" style={{ gap: 10 }}>
            <span className="small muted">{`Выбрано сборок: ${selected.size}`}</span>
            <div className="grow" />
            <Button icon={<Import size={15} />} onClick={runImport} disabled={!selected.size} loading={busy}>
              Импортировать выбранные
            </Button>
          </div>
        </div>
      )}

      {log.length > 0 && (
        <section className="panel import-log">
          {log.map((line, i) => (
            <div key={i} className="small">{line}</div>
          ))}
        </section>
      )}

      <Modal
        open={toDelete.length > 0}
        onClose={() => !deleting && setToDelete([])}
        title="Удалить сборки в старых лаунчерах?"
        actions={
          <>
            <Button variant="secondary" disabled={deleting} onClick={() => setToDelete([])}>
              Оставить всё
            </Button>
            <Button variant="danger" loading={deleting} disabled={!deleteChecked.size} onClick={deleteSources}>
              {`Удалить выбранные (${deleteChecked.size})`}
            </Button>
          </>
        }
      >
        <p className="small">
          Сборки уже перенесены в Ploxel. Отметьте, какие убрать из старых лаунчеров: их папки переместятся в корзину
          Windows, оттуда их можно вернуть.
        </p>
        <div className="col" style={{ gap: 8, marginTop: 12 }}>
          {toDelete.map((r) => (
            <label key={r.sourcePath} className="row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
              <Checkbox
                checked={deleteChecked.has(r.sourcePath!)}
                onChange={(v) =>
                  setDeleteChecked((prev) => {
                    const next = new Set(prev);
                    if (v) next.add(r.sourcePath!);
                    else next.delete(r.sourcePath!);
                    return next;
                  })
                }
                label={r.name}
              />
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 600 }}>
                  <span data-i18n-skip>{r.name}</span>
                  {r.launcherName ? <span className="muted">{` · ${r.launcherName}`}</span> : null}
                </span>
                <span className="tiny muted truncate" title={r.sourcePath} data-i18n-skip>
                  {r.sourcePath}
                </span>
                {r.sourceSize ? <span className="tiny muted">{fmtBytes(r.sourceSize)}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </Modal>

      {allInstances.some((i) => i.mods > 0) && (
        <p className="tiny muted row" style={{ gap: 6 }}>
          <CheckCircle2 size={13} /> После импорта можно нажать «Найти неисправности» — лаунчер найдёт недостающие
          зависимости и дубликаты.
        </p>
      )}
    </div>
  );
}

/** Загрузчик одной строкой: «fabric 0.16.9», «без загрузчика». */
function loaderLabel(loader: ImportedInstanceInfo['loader']): string {
  if (!loader) return 'загрузчик неизвестен';
  if (loader.kind === 'vanilla') return 'без загрузчика';
  return loader.version ? `${loader.kind} ${loader.version}` : loader.kind;
}

function ImportRow({
  inst,
  checked,
  onChange
}: {
  inst: ImportedInstanceInfo;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="import-row">
      <Checkbox checked={checked} onChange={onChange} label={inst.name} />
      <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
        <span className="truncate" style={{ fontWeight: 550 }} data-i18n-skip>{inst.name}</span>
        <span className="tiny muted">{`${inst.gameVersion ?? 'версия неизвестна'} · ${loaderLabel(inst.loader)} · модов: ${inst.mods} · миров: ${inst.worlds}`}</span>
      </div>
      <span className="chip">{fmtBytes(inst.sizeBytes)}</span>
    </div>
  );
}