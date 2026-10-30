import { useCallback, useState } from 'react';
import { ArrowLeft, Sparkles, Wand2 } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { TextArea } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { AiPickCards, LOADER_LABEL, type BuildPick, type PickLoader } from '../mods/AiPickCards';
import type { Instance } from '../../../shared/types';

/**
 * «Улучшить с ИИ»: ИИ получает список модов сборки и пожелание пользователя,
 * предлагает новые моды карточками с тумблерами, выбранное ставится в фоне.
 */
export function AiImproveModal({
  open,
  instance,
  modCount,
  onClose
}: {
  open: boolean;
  instance: Instance;
  modCount: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<BuildPick | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  const close = useCallback(() => onClose(), [onClose]);
  const selected = pick?.items.filter((i) => !off.has(i.project.id)) ?? [];
  const loader = instance.loader.kind === 'vanilla' ? null : LOADER_LABEL[instance.loader.kind as PickLoader];
  const target = loader ? `${instance.gameVersion} · ${loader}` : instance.gameVersion;

  const run = async () => {
    setBusy(true);
    try {
      setPick(await api.invoke<BuildPick>('ai:improvePick', instance.id, text));
      setOff(new Set());
    } catch (e) {
      toast('error', 'Не удалось подобрать улучшения', e instanceof Error ? e.message : String(e));
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

  const apply = async () => {
    if (!selected.length) return;
    setStarting(true);
    try {
      await api.invoke('ai:improve', instance.id, selected.map((i) => ({ projectId: i.project.id, source: i.project.source, kind: i.kind, title: i.project.title, iconUrl: i.project.iconUrl })));
      toast('info', `Улучшаем «${instance.name}»`, 'Моды устанавливаются в фоне — прогресс в меню слева.');
      setPick(null);
      setText('');
      onClose();
    } catch (e) {
      toast('error', 'Не удалось начать установку', e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      wide={!pick}
      xwide={!!pick}
      title={`Улучшить «${instance.name}» с ИИ`}
      actions={
        pick ? (
          <>
            <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={() => setPick(null)}>
              Изменить запрос
            </Button>
            <Button icon={<Wand2 size={15} />} disabled={!selected.length} loading={starting} onClick={apply}>
              {`Улучшить (${selected.length})`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Закрыть
            </Button>
            <Button onClick={run} loading={busy} disabled={text.trim().length < 5} icon={<Sparkles size={15} />}>
              Подобрать
            </Button>
          </>
        )
      }
    >
      {pick ? (
        <AiPickCards pick={pick} off={off} toggle={toggle} />
      ) : (
        <>
          <p className="small muted">
            {`ИИ получит список модов этой сборки (${modCount}) и предложит, что добавить. Как улучшить — напишите сами: «больше приключений», «красивее графика», «добавь технологии».`}
          </p>
          <TextArea value={text} onChange={setText} label="Как улучшить сборку" rows={3} placeholder="Например: добавь моды на приключения и новые биомы" />
          <p className="tiny muted">
            {`Подбираются только моды под Minecraft ${target}. Ваши моды не удаляются; если новый мод конфликтует со сборкой, лаунчер уберёт именно его.`}
          </p>
        </>
      )}
    </Modal>
  );
}
