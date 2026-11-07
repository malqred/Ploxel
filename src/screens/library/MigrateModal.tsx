import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../ui/Overlay';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import type { Instance } from '../../../shared/types';

interface MigrationItem {
  name: string;
  kind: string;
  status: 'ok' | 'keep' | 'missing' | 'local';
  newVersion?: string;
}
interface MigrationPlan {
  from: string;
  to: string;
  loader: string;
  loaderAvailable: boolean;
  items: MigrationItem[];
  modsOk: number;
  modsTotal: number;
  downgrade: boolean;
}

/**
 * «Перенести на другую версию»: сначала итог по модам, потом копия сборки
 * с обновлёнными модами. Исходная сборка остаётся как была.
 */
export function MigrateModal({ open, instance, onClose }: { open: boolean; instance: Instance; onClose: () => void }) {
  const [versions, setVersions] = useState<string[]>([]);
  const [to, setTo] = useState('');
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setTo('');
    void api
      .invoke<{ versions: { id: string; type: string }[] }>('versions:list')
      .then((r) => setVersions(r.versions.filter((v) => v.type === 'release' && v.id !== instance.gameVersion).map((v) => v.id)))
      .catch(() => undefined);
  }, [open, instance.id]);

  const check = async (version: string) => {
    setTo(version);
    setPlan(null);
    setChecking(true);
    try {
      setPlan(await api.invoke<MigrationPlan>('instances:planMigration', instance.id, version));
    } catch (e) {
      toast('error', 'Не удалось проверить моды', e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const missing = useMemo(() => plan?.items.filter((i) => i.kind === 'mod' && (i.status === 'missing' || i.status === 'local')) ?? [], [plan]);

  const migrate = () => {
    if (!plan) return;
    onClose();
    toast('info', `Переносим на ${plan.to}`, 'Прогресс — в меню слева. Исходная сборка не меняется.');
    void api
      .invoke<{ instance: Instance; updated: number; disabled: string[] }>('instances:migrate', instance.id, plan.to)
      .then((res) => {
        toast(
          res.disabled.length ? 'warning' : 'success',
          `Готово: «${res.instance.name}»`,
          res.disabled.length ? `Выключены моды без версии под ${plan.to}: ${res.disabled.join(', ')}` : `Обновлено модов: ${res.updated}`
        );
        window.location.hash = `/library?instance=${res.instance.id}`;
      })
      .catch((e) => toast('error', 'Перенос не удался', e instanceof Error ? e.message : String(e)));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Перенести «${instance.name}» на другую версию`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={migrate} disabled={!plan || !plan.loaderAvailable || checking}>
            {plan ? `Создать копию на ${plan.to}` : 'Создать копию'}
          </Button>
        </>
      }
    >
      <p className="small soft" style={{ marginTop: 0 }}>
        Лаунчер найдёт для каждого мода версию под новую игру и создаст копию сборки с обновлёнными модами. Эта сборка
        останется как есть.
      </p>
      <div className="field">
        <span className="field__label">Новая версия игры</span>
        <Select
          value={to}
          options={versions.map((v) => ({ value: v, label: v }))}
          onChange={(v) => void check(v)}
          placeholder="Выберите версию"
          width="100%"
        />
      </div>

      {checking && (
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          <span className="small muted">Ищем версии модов…</span>
          <div className="skeleton" style={{ height: 48 }} />
        </div>
      )}

      {plan && !checking && (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {!plan.loaderAvailable ? (
            <div className="notice">
              <div>{`Загрузчика ${plan.loader} для Minecraft ${plan.to} нет — перенос на эту версию невозможен.`}</div>
            </div>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              {plan.modsOk === plan.modsTotal ? (
                <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
              ) : (
                <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
              )}
              <strong>{plan.modsTotal ? `Модов с версией под ${plan.to}: ${plan.modsOk} из ${plan.modsTotal}` : 'В сборке нет модов — перенос просто сменит версию игры'}</strong>
            </div>
          )}
          {plan.downgrade && (
            <div className="notice">
              <div>Это более старая версия игры: миры из новой версии в ней могут не открыться. В копии они останутся, но играть в них лучше в исходной сборке.</div>
            </div>
          )}
          {missing.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="small">Нет версии — в копии будут выключены (можно включить, когда автор обновит мод):</span>
              <div className="col migrate-list">
                {missing.map((m) => (
                  <span key={m.name} className="small muted row" style={{ gap: 6 }}>
                    <MinusCircle size={13} /> <span data-i18n-skip>{m.name}</span>
                    {m.status === 'local' && <span className="tiny">· свой файл, каталогу неизвестен</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
