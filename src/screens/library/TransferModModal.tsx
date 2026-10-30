import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Controls';
import { Modal } from '../../ui/Overlay';
import { Select } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import type { Instance, InstalledMod } from '../../../shared/types';

const LOADER: Record<string, string> = {
  vanilla: 'без загрузчика',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
};

/** Перенос мода, ресурспака или шейдера в другую сборку. */
export function TransferModModal({
  mod,
  instance,
  onClose,
  onDone
}: {
  mod: InstalledMod | null;
  instance: Instance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<Instance[]>([]);
  const [targetId, setTargetId] = useState('');
  const [keepCopy, setKeepCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!mod) return;
    setKeepCopy(false);
    void api.invoke<Instance[]>('instances:list').then((list) => {
      const rest = list.filter((i) => i.id !== instance.id && (mod.kind !== 'mod' || i.loader.kind !== 'vanilla'));
      setTargets(rest);
      // Сначала сборки той же версии и загрузчика — туда файл переносится как есть
      const same = rest.find((i) => i.gameVersion === instance.gameVersion && i.loader.kind === instance.loader.kind);
      setTargetId((same ?? rest[0])?.id ?? '');
    });
  }, [mod, instance.id, instance.gameVersion, instance.loader.kind]);

  if (!mod) return null;
  const target = targets.find((t) => t.id === targetId);
  const same =
    !!target &&
    target.gameVersion === instance.gameVersion &&
    (mod.kind !== 'mod' || target.loader.kind === instance.loader.kind);
  const fromCatalog = !!mod.projectId && mod.source !== 'local';

  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await api.invoke<{ mode: 'copied' | 'catalog'; dependencies: number }>(
        'mods:transfer',
        instance.id,
        mod.id,
        target.id,
        { keepCopy }
      );
      const detail =
        res.mode !== 'catalog'
          ? `Сборка: ${target.name}`
          : res.dependencies > 0
            ? `В «${target.name}» поставлена версия под ${target.gameVersion}, зависимостей добавлено: ${res.dependencies}.`
            : `В «${target.name}» поставлена версия под ${target.gameVersion}.`;
      toast('success', keepCopy ? `«${mod.name}» скопирован` : `«${mod.name}» перенесён`, detail);
      onDone();
      onClose();
    } catch (e) {
      toast('error', 'Не удалось перенести', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Перенести «${mod.name}»`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={<ArrowRightLeft size={15} />} loading={busy} disabled={!target} onClick={run}>
            {keepCopy ? 'Скопировать' : 'Перенести'}
          </Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="small muted">
          {mod.kind === 'mod'
            ? 'Других сборок с загрузчиком модов пока нет. Создайте сборку во вкладке «Сборки».'
            : 'Других сборок пока нет. Создайте сборку во вкладке «Сборки».'}
        </p>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <div className="col" style={{ gap: 6 }}>
            <span className="field__label">В какую сборку</span>
            <Select
              value={targetId}
              onChange={setTargetId}
              width="100%"
              skipLabels
              options={targets.map((t) => ({
                value: t.id,
                label: t.name,
                hint: `${t.gameVersion} · ${LOADER[t.loader.kind] ?? t.loader.kind}`
              }))}
            />
          </div>
          {target && !same && (
            <div className="notice">
              <div>
                {fromCatalog
                  ? `Сборка «${target.name}» на другой версии игры или загрузчике. Лаунчер поставит туда подходящую версию из каталога вместе с зависимостями.`
                  : `Сборка «${target.name}» на другой версии игры или загрузчике, а этот файл добавлен вручную. Он скопируется как есть и может не заработать.`}
              </div>
            </div>
          )}
          <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
            <Checkbox checked={keepCopy} onChange={setKeepCopy} label="Оставить в этой сборке" />
            <span className="col" style={{ gap: 2 }}>
              <span>Оставить в этой сборке</span>
              <span className="tiny muted">Без галочки файл уберётся отсюда после переноса.</span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
