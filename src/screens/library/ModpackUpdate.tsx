import { useEffect, useState } from 'react';
import { PackageOpen, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../ui/Overlay';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { fmtDate } from '../../i18n';
import { requestManualDownloads } from '../../ui/ManualDownloads';
import type { Instance, ManualFile } from '../../../shared/types';

interface PackVersion {
  id: string;
  name: string;
  gameVersions: string[];
  date: string;
}
interface UpdatePlan {
  fromVersion: string;
  toVersion: string;
  gameVersion: { from: string; to: string };
  loader: { from: string; to: string };
  added: string[];
  updated: string[];
  removed: string[];
  configsUpdated: number;
  configsKept: number;
  userFiles: number;
  blocked: string[];
}

/** Блок «Модпак» на странице сборки: какая версия стоит и есть ли новее. */
export function ModpackPanel({ instance, onUpdated }: { instance: Instance; onUpdated: () => void }) {
  const [info, setInfo] = useState<{ current?: string; versions: PackVersion[] } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const load = () => {
    setError('');
    void api
      .invoke<{ current?: string; versions: PackVersion[] }>('modpack:versions', instance.id)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [instance.id, instance.source?.versionId]);

  const current = info?.versions.find((v) => v.id === info.current);
  const latest = info?.versions[0];
  const hasUpdate = !!latest && !!info?.current && latest.id !== info.current;

  return (
    <section className="panel">
      <h3 className="panel__title row" style={{ gap: 8 }}>
        <PackageOpen size={17} /> Модпак
      </h3>
      {error ? (
        <p className="small muted">{error}</p>
      ) : !info ? (
        <div className="skeleton" style={{ height: 40, marginTop: 8 }} />
      ) : (
        <div className="col" style={{ gap: 8, marginTop: 6 }}>
          <span className="small muted">
            {current ? `Стоит версия ${current.name}` : 'Версия модпака неизвестна'}
          </span>
          {hasUpdate ? (
            <Button block icon={<RefreshCw size={15} />} onClick={() => setOpen(true)}>
              {`Обновить до ${latest!.name}`}
            </Button>
          ) : (
            <span className="small">Стоит последняя версия</span>
          )}
        </div>
      )}
      {info && (
        <ModpackUpdateModal
          open={open}
          instance={instance}
          versions={info.versions.filter((v) => v.id !== info.current)}
          onClose={() => setOpen(false)}
          onDone={() => {
            onUpdated();
            load();
          }}
        />
      )}
    </section>
  );
}

function ModpackUpdateModal({
  open,
  instance,
  versions,
  onClose,
  onDone
}: {
  open: boolean;
  instance: Instance;
  versions: PackVersion[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState('');
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const check = async (id: string) => {
    setTarget(id);
    setPlan(null);
    setLoading(true);
    try {
      setPlan(await api.invoke<UpdatePlan>('modpack:planUpdate', instance.id, id));
    } catch (e) {
      toast('error', 'Не удалось сравнить версии', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open && versions[0]) void check(versions[0].id);
  }, [open]);

  const update = () => {
    onClose();
    toast('info', `Обновляем «${instance.name}»`, 'Прогресс — в меню слева. Ваши миры, настройки и свои моды останутся.');
    void api
      .invoke<{ plan: UpdatePlan; manual: ManualFile[] }>('modpack:update', instance.id, target)
      .then((res) => {
        toast('success', `Модпак обновлён до ${res.plan.toVersion}`, 'Заменённые файлы лежат в папке backups сборки.');
        requestManualDownloads(res.manual);
        onDone();
      })
      .catch((e) => toast('error', 'Обновление не удалось', e instanceof Error ? e.message : String(e)));
  };

  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div className="col" style={{ gap: 3 }}>
        <span className="small">{`${title}: ${items.length}`}</span>
        <div className="migrate-list col">
          {items.map((n) => (
            <span key={n} className="tiny muted truncate" data-i18n-skip>
              {n}
            </span>
          ))}
        </div>
      </div>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Обновление модпака «${instance.name}»`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={update} disabled={!plan || loading}>
            {plan ? `Обновить до ${plan.toVersion}` : 'Обновить'}
          </Button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Версия модпака</span>
        <Select
          value={target}
          options={versions.map((v) => ({ value: v.id, label: v.name, hint: `${v.gameVersions.slice(0, 2).join(', ')} · ${fmtDate(v.date)}` }))}
          onChange={(v) => void check(v)}
          width="100%"
        />
      </div>
      {loading && (
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          <span className="small muted">Сравниваем версии модпака…</span>
          <div className="skeleton" style={{ height: 60 }} />
        </div>
      )}
      {plan && !loading && (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {plan.gameVersion.from !== plan.gameVersion.to && (
            <div className="notice">
              <div>{`Новая версия модпака — для Minecraft ${plan.gameVersion.to}. Миры обновятся при первом входе; вернуть их на старую версию будет нельзя.`}</div>
            </div>
          )}
          {list('Обновятся', plan.updated)}
          {list('Добавятся', plan.added)}
          {list('Удалятся (автор убрал из модпака)', plan.removed)}
          <span className="small muted">
            {`Настройки модпака: обновятся ${plan.configsUpdated}, ваши изменённые останутся (${plan.configsKept}). Своих модов и паков, которые останутся как есть: ${plan.userFiles}. Миры, скриншоты и options.txt не трогаются.`}
          </span>
          {plan.blocked.length > 0 && (
            <span className="small" style={{ color: 'var(--warning)' }}>
              {`Только с сайта CurseForge (лаунчер подскажет, как скачать): ${plan.blocked.join(', ')}`}
            </span>
          )}
          {!plan.updated.length && !plan.added.length && !plan.removed.length && !plan.configsUpdated && (
            <span className="small">Файлы модпака не изменились — обновится только номер версии.</span>
          )}
        </div>
      )}
    </Modal>
  );
}
