import { useEffect, useState } from 'react';
import { FolderSearch, Import } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { Select, TextField } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import type { Instance, LoaderKind } from '../../../shared/types';

const LOADERS: { id: LoaderKind; label: string }[] = [
  { id: 'vanilla', label: 'Без загрузчика' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'quilt', label: 'Quilt' }
];

export function ImportMinecraftModal({
  open,
  onClose,
  onImported
}: {
  open: boolean;
  onClose: () => void;
  onImported: (instance: Instance) => void;
}) {
  const [folder, setFolder] = useState('');
  const [scan, setScan] = useState<{ versions: string[]; mods: number; worlds: number } | null>(null);
  const [name, setName] = useState('Импорт .minecraft');
  const [gameVersion, setGameVersion] = useState('');
  const [kind, setKind] = useState<LoaderKind>('vanilla');
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const pickFolder = async () => {
    const dir = await api.dialog.folder('Выберите папку .minecraft');
    if (!dir) return;
    setFolder(dir);
    const info = await api.invoke<{ versions: string[]; mods: number; worlds: number }>('minecraft:scan', dir);
    setScan(info);
    if (info.versions[0]) setGameVersion(info.versions.sort().reverse()[0]);
  };

  useEffect(() => {
    if (!open) {
      setFolder('');
      setScan(null);
      setKind('vanilla');
      setLoaderVersion('');
    }
  }, [open]);

  useEffect(() => {
    if (kind === 'vanilla' || !gameVersion) {
      setLoaderVersions([]);
      setLoaderVersion('');
      return;
    }
    api
      .invoke<{ versions: string[] }>('versions:loaders', gameVersion, kind)
      .then((res) => {
        setLoaderVersions(res.versions);
        setLoaderVersion(res.versions[0] ?? '');
      })
      .catch(() => setLoaderVersions([]));
  }, [kind, gameVersion]);

  const run = async () => {
    if (!folder || !gameVersion) return;
    setBusy(true);
    try {
      const instance = await api.invoke<Instance>('minecraft:import', {
        folder,
        name: name.trim() || 'Импорт .minecraft',
        gameVersion,
        loader: kind === 'vanilla' ? { kind } : { kind, version: loaderVersion }
      });
      toast('success', 'Импорт завершён', instance.name);
      onImported(instance);
      onClose();
    } catch (e) {
      toast('error', 'Импорт не удался', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Импорт существующей .minecraft"
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button icon={<Import size={15} />} onClick={run} loading={busy} disabled={!folder || !gameVersion}>
            Импортировать
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1 }}>
          <TextField value={folder} onChange={setFolder} placeholder="C:\\Users\\Имя\\AppData\\Roaming\\.minecraft" />
        </div>
        <Button variant="secondary" icon={<FolderSearch size={15} />} onClick={pickFolder}>
          Выбрать папку
        </Button>
      </div>

      {scan && (
        <div className="notice">
          <div>{`Найдено: версий — ${scan.versions.length}, модов — ${scan.mods}, миров — ${scan.worlds}. Скопируем только моды, ресурспаки, шейдеры, конфиги, миры и настройки игры. Файлы версий и ассеты останутся общими — лаунчер докачает их сам.`}</div>
        </div>
      )}

      <div className="create-grid">
        <div className="field--full">
          <TextField label="Название сборки" value={name} onChange={setName} />
        </div>
        <div className="field">
          <span className="field__label">Версия игры</span>
          <Select
            value={gameVersion}
            options={(scan?.versions.length ? scan.versions.sort().reverse() : []).map((v) => ({ value: v, label: v }))}
            onChange={setGameVersion}
            placeholder="Выберите версию"
          />
        </div>
        <div className="field">
          <span className="field__label">Загрузчик</span>
          <div className="loader-pills">
            {LOADERS.map((l) => (
              <button key={l.id} className="chip chip--button" data-active={kind === l.id} onClick={() => setKind(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {kind !== 'vanilla' && (
          <div className="field">
            <span className="field__label">{`Версия ${kind}`}</span>
            <Select
              value={loaderVersion}
              options={loaderVersions.map((v) => ({ value: v, label: v }))}
              onChange={setLoaderVersion}
              placeholder="Нет версий"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}