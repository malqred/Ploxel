import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Hammer, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { Select, TextArea, TextField } from '../../ui/TextField';
import { useSettings } from '../../state/settings';
import { useToast } from '../../state/toast';
import type { Instance } from '../../../shared/types';
import { AiPickCards, LOADER_LABEL, type BuildPick } from './AiPickCards';

type CountRange = '0-20' | '20-50' | '50-100' | '100-200' | '200+';
const COUNTS: { value: CountRange; label: string }[] = [
  { value: '0-20', label: 'до 20 модов' },
  { value: '20-50', label: '20–50 модов' },
  { value: '50-100', label: '50–100 модов' },
  { value: '100-200', label: '100–200 модов' },
  { value: '200+', label: '200+ модов' }
];

type Phase = 'ask' | 'pick' | 'name';

export function AiSuggestModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (instance: Instance) => void;
}) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<BuildPick | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('ask');
  const [name, setName] = useState('');
  const [loader, setLoader] = useState<BuildPick['loader']>('fabric');
  const [gameVersion, setGameVersion] = useState('');
  const [versions, setVersions] = useState<string[]>([]);
  const [count, setCount] = useState<CountRange>('20-50');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open || versions.length) return;
    void api
      .invoke<{ latest?: { release?: string }; versions: { id: string; type: string }[] }>('versions:list')
      .then((res) => {
        const list = res.versions.filter((v) => v.type === 'release').map((v) => v.id);
        setVersions(list);
        setGameVersion((cur) => cur || res.latest?.release || list[0] || '');
      })
      .catch(() => undefined);
  }, [open, versions.length]);

  const selected = useMemo(() => pick?.items.filter((i) => !off.has(i.project.id)) ?? [], [pick, off]);
  const defaultName = pick ? `${LOADER_LABEL[pick.loader]} ${pick.gameVersion}` : '';

  const reset = () => {
    setPick(null);
    setOff(new Set());
    setPhase('ask');
    setName('');
  };

  // Стабильная ссылка: Modal переставляет фокус при смене onClose
  const close = useCallback(() => onClose(), [onClose]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.invoke<BuildPick>('ai:pickBuild', { text, gameVersion: gameVersion || undefined, loader, count });
      setPick(res);
      setOff(new Set());
      setPhase('pick');
    } catch (e) {
      toast('error', 'Не удалось подобрать сборку', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Сборка создаётся сразу, моды ставятся в фоне: прогресс — в карточке
  // загрузок слева, итог — уведомлением
  const build = async () => {
    if (!pick || starting) return;
    setStarting(true);
    try {
      const created = await api.invoke<Instance>('ai:assemble', {
        name: name.trim() || defaultName,
        gameVersion: pick.gameVersion,
        loader: pick.loader,
        memoryMb: settings?.general.memoryMb,
        items: selected.map((i) => ({ projectId: i.project.id, kind: i.kind, title: i.project.title, iconUrl: i.project.iconUrl }))
      });
      toast('info', `Сборка «${created.name}» создана`, 'Моды устанавливаются в фоне — прогресс в меню слева.');
      onCreated?.(created);
      reset();
      setText('');
      onClose();
      window.location.hash = `/library?instance=${created.id}`;
    } catch (e) {
      toast('error', 'Не удалось создать сборку', e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const actions =
    phase === 'ask' ? (
      <>
        <Button variant="secondary" onClick={close}>
          Закрыть
        </Button>
        <Button onClick={run} loading={busy} disabled={text.trim().length < 5} icon={<Sparkles size={15} />}>
          Подобрать
        </Button>
      </>
    ) : phase === 'pick' ? (
      <>
        <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={reset}>
          Изменить запрос
        </Button>
        <Button icon={<Hammer size={15} />} disabled={selected.length === 0} onClick={() => setPhase('name')}>
          {`Собрать (${selected.length})`}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={() => setPhase('pick')}>
          Назад
        </Button>
        <Button icon={<Hammer size={15} />} onClick={build} loading={starting}>
          Создать сборку
        </Button>
      </>
    );

  return (
    <Modal open={open} onClose={close} xwide={phase === 'pick'} wide={phase !== 'pick'} title="Подбор сборки с ИИ" actions={actions}>
      {phase === 'ask' && (
        <>
          <p className="small muted">
            Опишите, какую сборку хотите: «оптимизация для слабого ПК», «магия и приключения на 1.20.1», «красивые
            шейдеры без сильной нагрузки». ИИ предложит моды, ресурспаки и шейдеры, а лаунчер соберёт из них сборку. В
            интернет уйдёт только этот текст.
          </p>
          <TextArea
            value={text}
            onChange={setText}
            label="Пожелания"
            rows={3}
            placeholder="Например: оптимизация, красивые анимации и шейдеры Complementary"
          />
          <div className="ai-ask__params">
            <label className="field">
              <span className="field__label">Загрузчик</span>
              <Select
                value={loader}
                options={(Object.keys(LOADER_LABEL) as BuildPick['loader'][]).map((l) => ({ value: l, label: LOADER_LABEL[l] }))}
                onChange={(v) => setLoader(v as BuildPick['loader'])}
                width="100%"
              />
            </label>
            <label className="field">
              <span className="field__label">Версия Minecraft</span>
              <Select
                value={gameVersion}
                options={versions.slice(0, 120).map((v) => ({ value: v, label: v }))}
                onChange={setGameVersion}
                placeholder="Загрузка…"
                width="100%"
              />
            </label>
            <label className="field">
              <span className="field__label">Количество модов</span>
              <Select value={count} options={COUNTS} onChange={(v) => setCount(v as CountRange)} width="100%" />
            </label>
          </div>
          <p className="tiny muted">
            ИИ подбирает только моды с версией под выбранные загрузчик и Minecraft. После установки лаунчер проверит
            совместимость и сам уберёт конфликтующие моды.
          </p>
        </>
      )}

      {phase === 'pick' && pick && <AiPickCards pick={pick} off={off} toggle={toggle} />}

      {phase === 'name' && pick && (
        <div className="col" style={{ gap: 10 }}>
          <TextField
            value={name}
            onChange={setName}
            label="Название сборки"
            placeholder={defaultName}
            hint={`Если оставить пустым — «${defaultName}».`}
            onEnter={build}
          />
          <span className="small muted">{`В сборку войдёт: ${selected.length} шт. Версия игры ${pick.gameVersion}, загрузчик ${LOADER_LABEL[pick.loader]}.`}</span>
        </div>
      )}

    </Modal>
  );
}
