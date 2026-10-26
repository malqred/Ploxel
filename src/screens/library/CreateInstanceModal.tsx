import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { Toggle, Slider } from '../../ui/Controls';
import { Select, TextField } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { fmtDate } from '../../i18n';
import { javaFits } from '../../../shared/java-fit';
import type { Instance, LoaderKind } from '../../../shared/types';

interface VersionOption {
  id: string;
  type: string;
  releaseTime: string;
}

interface JavaInstall {
  path: string;
  major: number;
  source: string;
  label: string;
}

const LOADERS: { id: LoaderKind; label: string }[] = [
  { id: 'vanilla', label: 'Без загрузчика' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'forge', label: 'Forge' },
  { id: 'quilt', label: 'Quilt' }
];

const DOWNLOAD_VALUE = '__download__';

export function CreateInstanceModal({
  open,
  onClose,
  onCreated,
  presetVersion
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (instance: Instance) => void;
  /** Версия, выбранная заранее (например, из новостей Minecraft) */
  presetVersion?: string;
}) {
  const { settings, info } = useSettings();
  const [name, setName] = useState('');
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [gameVersion, setGameVersion] = useState('');
  const [kind, setKind] = useState<LoaderKind>('fabric');
  const [snapshots, setSnapshots] = useState(false);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [memory, setMemory] = useState(4);
  const [javaChoice, setJavaChoice] = useState('');
  const [java, setJava] = useState<{ required: number; component?: string; installs: JavaInstall[]; recommendedPath?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const totalGb = Math.floor((info?.totalMemMb ?? 8192) / 1024);
  const maxGb = Math.max(2, Math.min(32, totalGb - 2));
  const defaultGb = Math.round((settings?.general.memoryMb ?? 4096) / 1024);

  useEffect(() => {
    if (!open) return;
    setName('');
    setMemory(Math.min(defaultGb, maxGb));
    setGameVersion(presetVersion ?? '');
    setLoaderVersion('');
    // Снапшот из новостей: под него почти никогда нет загрузчиков модов
    const presetSnapshot = !!presetVersion && !/^\d+(\.\d+)+$/.test(presetVersion);
    setKind(presetSnapshot ? 'vanilla' : 'fabric');
    setSnapshots(presetSnapshot || !!settings?.general.showSnapshots);
  }, [open]);

  // Снапшоты и старые версии — переключателем в окне (по умолчанию как в Настройки → Общие)
  useEffect(() => {
    if (!open) return;
    void api.invoke<{ latest: { release: string }; versions: VersionOption[] }>('versions:list', snapshots).then((res) => {
      setVersions(res.versions);
      setGameVersion((prev) => (prev && res.versions.some((v) => v.id === prev) ? prev : presetVersion ?? res.latest.release));
    });
  }, [open, snapshots]);

  useEffect(() => {
    if (!open || !gameVersion) return;
    setLoaderVersion('');
    setLoaderVersions([]);
    if (kind === 'vanilla') return;
    void api
      .invoke<{ versions: string[]; error?: string }>('versions:loaders', gameVersion, kind)
      .then((res) => {
        setLoaderVersions(res.versions);
        setLoaderVersion(res.versions[0] ?? '');
        if (res.error) toast('warning', 'Не удалось получить версии загрузчика', res.error);
      })
      .catch(() => setLoaderVersions([]));
  }, [kind, gameVersion, open]);

  useEffect(() => {
    if (!open || !gameVersion) return;
    void api
      .invoke<{ required: number; component?: string; installs: JavaInstall[]; recommendedPath?: string }>(
        'java:recommend',
        gameVersion
      )
      .then((res) => {
        setJava(res);
        setJavaChoice(res.recommendedPath ?? DOWNLOAD_VALUE);
      })
      .catch(() => setJava(null));
  }, [gameVersion, open]);

  const versionOptions = useMemo(
    () =>
      versions.slice(0, 160).map((v) => ({
        value: v.id,
        label: v.id,
        hint: v.type === 'release' ? fmtDate(v.releaseTime) : v.type
      })),
    [versions]
  );

  const javaOptions = useMemo(() => {
    if (!java) return [] as { value: string; label: string; hint?: string }[];
    const list = java.installs.map((j) => ({
      value: j.path,
      label: `Java ${j.major} · ${j.label}`,
      hint: j.path === java.recommendedPath ? 'рекомендуемая' : !javaFits(j.major, java.required ?? 8) ? 'не подходит для этой версии игры' : undefined
    }));
    if (java.component) {
      list.unshift({
        value: DOWNLOAD_VALUE,
        label: `Скачать Java ${java.required} (официальный рантайм)`,
        hint: 'автоматически'
      });
    }
    return list;
  }, [java]);

  // Папка сборки создаётся сразу и окно закрывается; Java и загрузчик
  // докачиваются в фоне — прогресс в меню слева
  const create = async () => {
    if (!gameVersion) return;
    setBusy(true);
    let instance: Instance;
    try {
      instance = await api.invoke<Instance>('instances:create', {
        name: name.trim() || `Сборка ${gameVersion}`,
        gameVersion,
        loader: kind === 'vanilla' ? { kind } : { kind, version: loaderVersion || undefined },
        memoryMb: Math.round(memory) * 1024,
        javaPath: javaChoice && javaChoice !== DOWNLOAD_VALUE ? javaChoice : undefined
      });
    } catch (e) {
      toast('error', 'Не удалось создать сборку', e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    toast('success', 'Сборка создана', `${instance.name} · ${gameVersion}`);
    onCreated(instance);
    onClose();
    setBusy(false);
    const needJava = javaChoice === DOWNLOAD_VALUE && java?.component ? java.component : null;
    try {
      if (needJava) {
        const downloaded = await api.invoke<{ path: string }>('java:download', needJava);
        await api.invoke('instances:update', instance.id, { javaPath: downloaded.path });
      }
      if (kind !== 'vanilla' && loaderVersion) await api.invoke('versions:installLoader', gameVersion, kind, loaderVersion);
    } catch (e) {
      toast('warning', 'Не всё докачалось заранее', `${e instanceof Error ? e.message : String(e)}. Лаунчер докачает это при запуске.`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Создать сборку"
      wide
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={create} loading={busy} disabled={!gameVersion} icon={<Check size={16} />}>
            Создать
          </Button>
        </>
      }
    >
      <div className="create-grid">
        <div className="field--full">
          <TextField label="Название сборки" value={name} onChange={setName} placeholder={`Сборка ${gameVersion || ''}`} />
        </div>
        <div className="field">
          <span className="field__label">Версия игры</span>
          <Select value={gameVersion} options={versionOptions} onChange={setGameVersion} placeholder="Выберите версию" />
          <div className="row small" style={{ gap: 10, marginTop: 8 }}>
            <Toggle
              checked={snapshots}
              onChange={setSnapshots}
              disabled={busy}
              label="Показывать снапшоты и старые версии"
            />
            <button
              type="button"
              className="snap-inline-label"
              onClick={() => setSnapshots(!snapshots)}
              disabled={busy}
            >
              Показывать снапшоты и старые версии
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field__label">Загрузчик модов</span>
          <div className="loader-pills">
            {LOADERS.map((l) => (
              <button
                key={l.id}
                className="chip chip--button"
                data-active={kind === l.id ? 'true' : undefined}
                onClick={() => setKind(l.id)}
                disabled={busy}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {kind === 'vanilla' ? (
          <div className="field">
            <span className="field__label">Без загрузчика</span>
            <span className="field__hint">Чистая игра: работают ресурспаки, моды и шейдеры — нет. Подходит для снапшотов — загрузчики модов выходят под них позже.</span>
          </div>
        ) : (
        <div className="field">
          <span className="field__label">{`Версия ${kind}`}</span>
          <Select
            value={loaderVersion}
            options={loaderVersions.map((v) => ({ value: v, label: v }))}
            onChange={setLoaderVersion}
            placeholder={loaderVersions.length ? 'Выберите версию' : 'Загрузка списка…'}
            disabled={!loaderVersions.length}
          />
          {loaderVersions.length > 0 && (
            <span className="field__hint">{`Доступно версий: ${loaderVersions.length}. Первая — самая новая.`}</span>
          )}
        </div>
        )}

        <div className="field">
          <span className="field__label">Java</span>
          <Select
            value={javaChoice}
            options={javaOptions}
            onChange={setJavaChoice}
            placeholder={java ? 'Нет доступных вариантов' : 'Определяем…'}
            disabled={!javaOptions.length}
          />
          <span className="field__hint">
            {java
              ? java.recommendedPath
                ? `Рекомендуемая: Java ${java.required}+. Можно выбрать установленную или скачать официальную.`
                : `Нужна Java ${java.required}+. Скачаем официальный рантайм Mojang.`
              : 'Проверяем установленные версии Java.'}
          </span>
        </div>

        <div className="field field--full">
          <span className="field__label">{`Память — ${Math.round(memory)} ГБ`}</span>
          <Slider
            value={Math.round(memory)}
            min={1}
            max={maxGb}
            step={1}
            onChange={setMemory}
            format={(v) => `${v} ГБ`}
            disabled={busy}
            marks={[
              { value: 1, label: '1 ГБ' },
              { value: Math.min(defaultGb, maxGb), label: `по умолчанию ${Math.min(defaultGb, maxGb)} ГБ` },
              { value: maxGb, label: `${maxGb} ГБ` }
            ]}
          />
          <span className="field__hint">{`Всего ОЗУ: ${totalGb} ГБ. Для лёгкой сборки хватит 2–3 ГБ, для крупного модпака — 6–8 ГБ.`}</span>
        </div>

        <div className="field--full">
          <div className="small muted row" style={{ gap: 8 }}>
            {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            Сборка получит отдельную папку: моды, конфиги, миры и логи не пересекаются с другими.
          </div>
          {!busy && java && !java.recommendedPath && (
            <span className="tiny muted row" style={{ gap: 4, marginTop: 6 }}>
              <Download size={12} /> Подходящая Java не найдена — будет скачана автоматически при создании.
            </span>
          )}
        </div>
      </div>
      <style>{`.spin{animation:spin 900ms linear infinite}`}</style>
    </Modal>
  );
}