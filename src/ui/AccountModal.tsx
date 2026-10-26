import { useEffect, useState } from 'react';
import { Check, Clock, Loader2, LogIn, UserRound } from 'lucide-react';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { TextField } from '../ui/TextField';
import { useToast } from '../state/toast';
import { useSettings } from '../state/settings';
import type { Account, AccountView } from '../../shared/types';

interface DeviceInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  tenant: string;
}

/**
 * Окно аккаунта: офлайн-ник или вход Microsoft.
 * Появляется по клику на профиль в сайдбаре.
 */
export function AccountModal({
  open,
  onClose,
  onChanged
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [nick, setNick] = useState('');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msAvailable, setMsAvailable] = useState(true);
  const { toast } = useToast();
  const { info } = useSettings();

  const load = async () => {
    const [list, current] = await Promise.all([
      api.invoke<AccountView[]>('accounts:views'),
      api.invoke<Account | null>('accounts:active')
    ]);
    setAccounts(list);
    setActive(current?.id ?? null);
  };

  useEffect(() => {
    if (open) {
      void load();
      setNick('');
      setError('');
      setDevice(null);
      void api.invoke<boolean>('integrations:msStatus').then(setMsAvailable);
    }
  }, [open]);

  const playOffline = async () => {
    if (nick.trim().length < 3) return;
    setBusy(true);
    try {
      const acc = await api.invoke<Account>('accounts:addOffline', nick);
      await load();
      onChanged();
      toast('success', 'Офлайн-профиль выбран', acc.name);
      onClose();
    } catch (e) {
      toast('error', 'Не удалось создать профиль', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loginMicrosoft = async () => {
    setError('');
    try {
      const d = await api.invoke<DeviceInfo>('auth:ms:start');
      setDevice(d);
      setWaiting(true);
      api
        .invoke<Account>('auth:ms:poll', d.deviceCode, d.interval, d.tenant)
        .then(async (acc) => {
          await load();
          onChanged();
          setDevice(null);
          toast('success', 'Вход выполнен', acc.name);
          onClose();
        })
        .catch((e) => setError(friendlyError(e instanceof Error ? e.message : String(e))))
        .finally(() => setWaiting(false));
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  };

  const choose = async (id: string) => {
    await api.invoke('accounts:setActive', id);
    await load();
    onChanged();
    onClose();
  };

  const friendlyError = (raw: string) => {
    if (raw.includes('9002346')) {
      return `${raw}\n\nПохоже, запущена старая версия лаунчера. Установите 0.3.2 или новее — в ней вход уже исправлен.`;
    }
    return raw;
  };

  return (
    <Modal open={open} onClose={onClose} title="Аккаунт" wide>
      {!device ? (
        <>
          <div className="account-modal">
            <section className="account-modal__col">
              <h3 className="account-modal__title">Играть офлайн</h3>
              <p className="small muted">
                Без входа в Microsoft. Подходит для одиночной игры и серверов без проверки лицензии. Ник можно
                придумать любой.
              </p>
              <TextField value={nick} onChange={setNick} placeholder="Ник (3–16 символов)" onEnter={playOffline} />
              <Button onClick={playOffline} loading={busy} disabled={nick.trim().length < 3} icon={<UserRound size={16} />}>
                Играть офлайн
              </Button>
            </section>

            <div className="account-modal__divider" />

            <section className="account-modal__col">
              <h3 className="account-modal__title">Играть онлайн</h3>
              <p className="small muted">
                Вход через Microsoft: официальные скины, плащи и лицензионные серверы. Пароль вводится только на
                сайте Microsoft.
              </p>
              <Button variant="secondary" onClick={loginMicrosoft} icon={<LogIn size={16} />} disabled={!msAvailable}>
                Войти через Microsoft
              </Button>
              {!msAvailable && (
                <div className="notice">
                  <div>
                    <strong>Вход через Microsoft недоступен в этой сборке лаунчера.</strong> Создайте
                    офлайн-профиль ниже — играть можно и без входа.
                  </div>
                </div>
              )}
              {error && <p className="small" style={{ color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>{error}</p>}
            </section>
          </div>

          {accounts.length > 0 && (
            <section className="account-modal__list">
              <span className="field__label">Сохранённые аккаунты</span>
              {accounts.map((acc) => (
                <button key={acc.id} className="account-row" onClick={() => choose(acc.id)}>
                  <span className="account-row__avatar">
                    {acc.skinUrl ? (
                      <span
                        style={{
                          backgroundImage: `url(${acc.skinUrl})`,
                          backgroundSize: '800%',
                          backgroundPosition: '-100% -100%',
                          imageRendering: 'pixelated',
                          width: '100%',
                          height: '100%'
                        }}
                      />
                    ) : (
                      acc.name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="col grow" style={{ gap: 1 }}>
                    <span style={{ fontWeight: 600 }}>{acc.name}</span>
                    <span className="tiny muted">
                      {acc.type === 'microsoft' ? 'Microsoft' : 'Офлайн-профиль'} ·{' '}
                      {acc.sessionState === 'valid'
                        ? 'сессия активна'
                        : acc.sessionState === 'expired'
                          ? 'сессия истекла'
                          : 'офлайн'}
                    </span>
                  </span>
                  {acc.id === active ? (
                    <span className="chip chip--accent">
                      <Check size={12} /> Выбран
                    </span>
                  ) : (
                    <span className="chip">Выбрать</span>
                  )}
                </button>
              ))}
            </section>
          )}
        </>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <p>
            Откройте <span className="mono">{device.verificationUri}</span> и введите код:
          </p>
          <div className="device-code">
            <span className="device-code__code">{device.userCode}</span>
            <div className="row" style={{ gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(device.userCode)}>
                Копировать код
              </Button>
              <Button size="sm" onClick={() => api.shell.openExternal(device.verificationUri)}>
                Открыть страницу
              </Button>
            </div>
          </div>
          {waiting && (
            <div className="row" style={{ gap: 8, color: 'var(--text-muted)' }}>
              <Loader2 size={15} className="spin" /> Ждём подтверждения…
            </div>
          )}
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <p className="tiny muted">
            <Clock size={11} /> Код действует около 15 минут. Лаунчер не видит пароль — его вводят только на
            сайте Microsoft.
          </p>
        </div>
      )}
      <style>{`.spin{animation:spin 900ms linear infinite}`}</style>
      <p className="tiny muted" style={{ textAlign: 'center', marginTop: 4 }}>
        Ploxel {info?.version ?? ''}
      </p>
    </Modal>
  );
}