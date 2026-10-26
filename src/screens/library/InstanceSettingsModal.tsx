import { useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, Image, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button, IconButton } from '../../ui/Button';
import { Slider } from '../../ui/Controls';
import { Modal } from '../../ui/Overlay';
import { Select, TextField } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { javaFits } from '../../../shared/java-fit';
import type { Instance } from '../../../shared/types';

interface JavaInstall {
  path: string;
  major: number;
  source: string;
  label: string;
}

const DOWNLOAD = '__download__';
const AUTO = '__auto__';

export function InstanceSettingsModal({
  instance,
  open,
  onClose,
  onSaved
}: {
  instance: Instance;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { info, settings } = useSettings();
  const [name, setName] = useState(instance.name);
  const [memory, setMemory] = useState((instance.memoryMb ?? settings?.general.memoryMb ?? 4096) / 1024);
  const [jvm, setJvm] = useState(instance.jvmArgs ?? '');
  const [server, setServer] = useState(instance.serverAddress ?? '');
  const [javaChoice, setJavaChoice] = useState(instance.javaPath ?? AUTO);
  const [java, setJava] = useState<{
    required: number;
    component?: string;
    installs: JavaInstall[];
    recommendedPath?: string;
  } | null>(null);
  const [cover, setCover] = useState(instance.coverDataUrl ?? '');
  const [busyJava, setBusyJava] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setName(instance.name);
    setMemory((instance.memoryMb ?? settings?.general.memoryMb ?? 4096) / 1024);
    setJvm(instance.jvmArgs ?? '');
    setServer(instance.serverAddress ?? '');
    setJavaChoice(instance.javaPath ?? AUTO);
    setCover(instance.coverDataUrl ?? '');
  }, [instance.id, instance.coverDataUrl, instance.javaPath, open]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const versionId = await api.invoke<string>('versions:resolveId', instance.gameVersion, instance.loader);
        const res = await api.invoke<{
          required: number;
          component?: string;
          installs: JavaInstall[];
          recommendedPath?: string;
        }>('java:recommend', versionId);
        setJava(res);
      } catch {
        setJava(null);
      }
    })();
  }, [open, instance.gameVersion, instance.loader.kind, instance.loader.version]);

  const totalGb = Math.floor((info?.totalMemMb ?? 8192) / 1024);
  const maxGb = Math.max(2, Math.min(32, totalGb - 2));
  const recommended = Math.min(8, Math.max(2, Math.floor(totalGb / 2)));

  const javaOptions = useMemo(() => {
    const list = [{ value: AUTO, label: 'Автоматически (рекомендуется)', hint: java?.recommendedPath ? 'Java найдена' : undefined }];
    for (const j of java?.installs ?? []) {
      list.push({
        value: j.path,
        label: `Java ${j.major} · ${j.label}`,
        hint: j.path === java?.recommendedPath ? 'рекомендуемая' : !javaFits(j.major, java?.required ?? 8) ? 'не подходит для этой версии игры' : undefined
      });
    }
    if (java?.component) {
      list.push({
        value: DOWNLOAD,
        label: `Скачать Java ${java.required} (официальная)`,
        hint: 'загрузка при сохранении'
      });
    }
    return list;
  }, [java]);

  const changeCover = async (remove = false) => {
    try {
      const updated = remove
        ? await api.invoke<Instance | null>('instances:removeCover', instance.id)
        : await api.invoke<Instance | null>('instances:setCover', instance.id);
      if (updated) {
        setCover(updated.coverDataUrl ?? '');
        onSaved();
        toast('success', remove ? 'Обложка убрана' : 'Обложка обновлена');
      }
    } catch (e) {
      toast('error', 'Не удалось изменить обложку', e instanceof Error ? e.message : String(e));
    }
  };

  // Сохраняем сразу; если выбрана загрузка Java — она идёт в фоне (прогресс
  // в меню слева), путь к Java подставится, когда загрузка закончится
  const save = async () => {
    const download = javaChoice === DOWNLOAD && java?.component ? java.component : null;
    const javaPath = javaChoice === AUTO || download ? '' : javaChoice;
    await api.invoke('instances:update', instance.id, {
      name: name.trim() || instance.name,
      memoryMb: Math.round(memory) * 1024,
      jvmArgs: jvm,
      javaPath: javaPath || undefined,
      serverAddress: server.trim() || undefined
    });
    toast('success', 'Настройки сборки сохранены', download ? 'Java скачивается в фоне — прогресс в меню слева.' : undefined);
    onSaved();
    onClose();
    if (!download) return;
    setBusyJava(true);
    try {
      const dl = await api.invoke<{ path: string }>('java:download', download);
      await api.invoke('instances:update', instance.id, { javaPath: dl.path });
      onSaved();
    } catch (e) {
      toast('error', 'Java не скачалась', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyJava(false);
    }
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      xwide
      title={<>{'Настройки сборки'} «<span data-i18n-skip>{instance.name}</span>»</>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={<Save size={15} />} onClick={save} loading={busyJava}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="instance-settings">
        <section className="instance-settings__section">
          <h3 className="settings-section__title">Общее</h3>
          <div className="cover-editor">
            <div
              className="cover-editor__preview"
              style={
                cover
                  ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : {
                      background: `linear-gradient(135deg, hsl(${instance.iconHue} 30% 52%), hsl(${(instance.iconHue + 45) % 360} 30% 74%))`
                    }
              }
            >
              {!cover && <span>{instance.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="col" style={{ gap: 6 }}>
              <Button variant="secondary" size="sm" icon={<Image size={14} />} onClick={() => changeCover(false)}>
                Загрузить обложку
              </Button>
              {cover && (
                <Button variant="neutral" size="sm" icon={<Trash2 size={14} />} onClick={() => changeCover(true)}>
                  Убрать
                </Button>
              )}
              <span className="tiny muted">PNG, JPG или WebP. Хранится в папке сборки.</span>
            </div>
          </div>
          <TextField label="Название" value={name} onChange={setName} />
        </section>

        <section className="instance-settings__section">
          <h3 className="settings-section__title">Производительность</h3>
          <div className="field">
            <span className="field__label">{`Память — ${Math.round(memory)} ГБ`}</span>
            <Slider
              value={Math.round(memory)}
              min={1}
              max={maxGb}
              step={1}
              onChange={setMemory}
              format={(v) => `${v} ГБ`}
              marks={[
                { value: 1, label: '1 ГБ' },
                { value: recommended, label: `рекомендуем ${recommended} ГБ` },
                { value: maxGb, label: `${maxGb} ГБ` }
              ]}
            />
          </div>
          <div className="field">
            <span className="field__label">Java</span>
            <Select value={javaChoice} options={javaOptions} onChange={setJavaChoice} />
            <span className="field__hint">
              {java
                ? `Для этой версии нужна Java ${java.required}+. Можно выбрать установленную или скачать официальную.`
                : 'Определяем требуемую версию Java…'}
            </span>
          </div>
          <TextField
            label="Свои аргументы JVM"
            value={jvm}
            onChange={setJvm}
            placeholder="Пусто — как в общих настройках"
            hint="Например: -XX:+UseG1GC. Для новичков менять не нужно."
          />
          <TextField
            label="Подключаться к серверу при запуске"
            value={server}
            onChange={setServer}
            placeholder="play.example.com:25565"
            hint="Minecraft 1.20+ поддерживает быстрое подключение."
          />
        </section>

        <div className="row" style={{ gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={15} />}
            onClick={() => api.invoke('instances:folder', instance.id)}
          >
            Открыть папку сборки
          </Button>
          <Button
            variant="neutral"
            size="sm"
            icon={<Download size={15} />}
            onClick={async () => {
              try {
                const file = await api.invoke<string | null>('modpack:export', instance.id);
                if (file) toast('success', 'Сборка экспортирована', file);
              } catch (e) {
                toast('error', 'Экспорт не удался', e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Экспорт модпака
          </Button>
          <IconButton label="Удалить обложку" size="sm" ghost onClick={() => changeCover(true)}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </Modal>

    </>
  );
}