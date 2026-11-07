import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, HelpCircle, MonitorX } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../ui/Overlay';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Controls';
import { Select } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import type { Instance } from '../../../shared/types';

interface ServerPlan {
  items: { name: string; fileName: string; side: 'server' | 'client' | 'unknown' }[];
  worlds: string[];
  loader: string;
  gameVersion: string;
}

const NEW_WORLD = '__new__';

/**
 * «Сделать сервер из сборки»: отдельная сборка-сервер, исходная не меняется.
 * Только клиентские моды на сервер не попадают; EULA пользователь принимает сам.
 */
export function ServerModal({ open, instance, onClose }: { open: boolean; instance: Instance; onClose: () => void }) {
  const [plan, setPlan] = useState<ServerPlan | null>(null);
  const [world, setWorld] = useState(NEW_WORLD);
  const [eula, setEula] = useState(false);
  const [offline, setOffline] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setEula(false);
    setWorld(NEW_WORLD);
    void api
      .invoke<ServerPlan>('server:plan', instance.id)
      .then(setPlan)
      .catch((e) => toast('error', 'Не удалось проверить моды', e instanceof Error ? e.message : String(e)));
  }, [open, instance.id]);

  const groups = useMemo(() => {
    const items = plan?.items ?? [];
    return {
      server: items.filter((i) => i.side === 'server'),
      client: items.filter((i) => i.side === 'client'),
      unknown: items.filter((i) => i.side === 'unknown')
    };
  }, [plan]);

  const create = () => {
    onClose();
    toast('info', 'Собираем сервер', 'Прогресс — в меню слева. Исходная сборка не меняется.');
    void api
      .invoke<Instance>('server:create', instance.id, { world: world === NEW_WORLD ? undefined : world, eula, offlinePlayers: offline })
      .then((server) => {
        toast('success', `Сервер готов: «${server.name}»`, 'Нажмите «Запустить сервер» на странице сборки.');
        window.location.hash = `/library?instance=${server.id}`;
      })
      .catch((e) => toast('error', 'Не удалось собрать сервер', e instanceof Error ? e.message : String(e)));
  };

  const names = (list: { name: string }[]) => list.map((i) => i.name).join(', ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Сервер из «${instance.name}»`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={create} disabled={!plan || !eula}>
            Создать сервер
          </Button>
        </>
      }
    >
      <p className="small soft" style={{ marginTop: 0 }}>
        Лаунчер создаст отдельную сборку-сервер: серверный Minecraft, загрузчик и только те моды, которые нужны серверу.
        Эта сборка не изменится. Друзья подключаются к вашему IP с такой же сборкой у себя.
      </p>
      {!plan ? (
        <div className="col" style={{ gap: 6 }}>
          <span className="small muted">Проверяем, какие моды нужны серверу…</span>
          <div className="skeleton" style={{ height: 60 }} />
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <div className="col" style={{ gap: 6 }}>
            <span className="small row" style={{ gap: 6 }}>
              <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> {`На сервер пойдут: ${groups.server.length + groups.unknown.length}`}
            </span>
            {groups.client.length > 0 && (
              <span className="small row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <MonitorX size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  {`Только для игрока, серверу не нужны: ${groups.client.length}`}
                  <span className="tiny muted" data-i18n-skip>{` — ${names(groups.client)}`}</span>
                </span>
              </span>
            )}
            {groups.unknown.length > 0 && (
              <span className="small row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <HelpCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  {`Не удалось проверить, пойдут на сервер: ${groups.unknown.length}`}
                  <span className="tiny muted"> — если сервер не запустится из-за мода, удалите его из папки mods сервера.</span>
                </span>
              </span>
            )}
          </div>

          <div className="field">
            <span className="field__label">Мир для сервера</span>
            <Select
              value={world}
              options={[{ value: NEW_WORLD, label: 'Новый мир' }, ...plan.worlds.map((w) => ({ value: w, label: w }))]}
              onChange={setWorld}
              width="100%"
            />
            <span className="field__hint">Мир копируется — в этой сборке он останется как был.</span>
          </div>

          <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
            <Checkbox checked={offline} onChange={setOffline} label="Пускать игроков без лицензии" />
            <span>Пускать игроков без лицензии (офлайн-аккаунты и Ely.by)</span>
          </label>
          <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
            <Checkbox checked={eula} onChange={setEula} label="Принимаю EULA Minecraft" />
            <span>
              Принимаю{' '}
              <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">
                лицензионное соглашение Minecraft (EULA)
              </a>{' '}
              — без этого сервер не запустится
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
