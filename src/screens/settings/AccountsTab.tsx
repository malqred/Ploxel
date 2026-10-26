import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, LogIn, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Button, IconButton } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { Modal, ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { Section } from './parts';
import type { Account, AccountView } from '../../../shared/types';

interface DeviceInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  tenant: string;
}

export function AccountsTab() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msAvailable, setMsAvailable] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nick, setNick] = useState('');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    const [list, current] = await Promise.all([
      api.invoke<AccountView[]>('accounts:views'),
      api.invoke<Account | null>('accounts:active')
    ]);
    setAccounts(list);
    setActive(current?.id ?? null);
  };

  useEffect(() => {
    void load();
    void api.invoke<boolean>('integrations:msStatus').then(setMsAvailable);
  }, []);

  const addOffline = async () => {
    try {
      await api.invoke('accounts:addOffline', nick);
      setNick('');
      await load();
      toast('success', 'Офлайн-профиль добавлен');
    } catch (e) {
      toast('error', 'Не удалось добавить профиль', e instanceof Error ? e.message : String(e));
    }
  };

  const startMicrosoft = async () => {
    setError('');
    try {
      const d = await api.invoke<DeviceInfo>('auth:ms:start');
      setDevice(d);
      setCopied(false);
      setWaiting(true);
      api
        .invoke<Account>('auth:ms:poll', d.deviceCode, d.interval, d.tenant)
        .then(async (acc) => {
          await load();
          setDevice(null);
          toast('success', 'Вход выполнен', acc.name);
        })
        .catch((e) => {
          const raw = e instanceof Error ? e.message : String(e);
          setError(raw.includes('9002346') ? `${raw}\n\nУстановите версию 0.3.2 или новее.` : raw);
        })
        .finally(() => setWaiting(false));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message.includes('9002346') ? `${message}\n\nУстановите версию 0.3.2 или новее.` : message);
      toast('error', 'Вход не начат', message);
    }
  };

  const copyCode = async () => {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('warning', 'Не удалось скопировать', 'Выделите код вручную.');
    }
  };

  const faceStyle = (account: Account) => ({
    backgroundImage: account.skinUrl ? `url(${account.skinUrl})` : undefined,
    backgroundSize: '800%',
    backgroundPosition: '-100% -100%',
    imageRendering: 'pixelated' as const
  });

  return (
    <>
      <Section
        title="Аккаунты"
        hint="Онлайн-вход через Microsoft даёт доступ к официальным скинам и серверам. Офлайн-профиль работает без интернета."
        actions={
          <Button
            size="sm"
            icon={<LogIn size={15} />}
            onClick={startMicrosoft}
            disabled={!msAvailable}
          >
            Войти через Microsoft
          </Button>
        }
      >
        {!msAvailable && (
          <div className="notice">
            <div>
              <strong>Вход через Microsoft недоступен в этой сборке лаунчера.</strong> Офлайн-профиль работает:
              можно играть в одиночные миры и на серверах без проверки лицензии.
            </div>
          </div>
        )}

        <div className="col" style={{ gap: 8 }}>
          {accounts.length === 0 && <p className="small muted">Пока нет ни одного аккаунта.</p>}
          {accounts.map((acc) => (
            <div className="account-card" key={acc.id} data-active={acc.id === active}>
              <span className="account-card__avatar" style={faceStyle(acc)}>
                {!acc.skinUrl && <span style={{ fontWeight: 700 }}>{acc.name.slice(0, 1).toUpperCase()}</span>}
              </span>
              <div className="col grow" style={{ gap: 1 }}>
                <span style={{ fontWeight: 650 }}>{acc.name}</span>
                <span className="tiny muted">
                  {acc.type === 'microsoft' ? 'Microsoft' : 'Офлайн-профиль'} ·{' '}
                  {acc.type === 'offline'
                    ? 'без сессии'
                    : acc.sessionState === 'valid'
                      ? 'сессия активна'
                      : 'сессия истекла'}
                </span>
              </div>
              {acc.type === 'microsoft' && acc.sessionState === 'expired' && (
                <Button
                  size="sm"
                  variant="neutral"
                  onClick={async () => {
                    try {
                      await api.invoke('auth:ms:refresh', acc.id);
                      await load();
                      toast('success', 'Сессия продлена', acc.name);
                    } catch (e) {
                      toast('error', 'Не удалось продлить', e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Обновить
                </Button>
              )}
              {acc.id === active ? (
                <span className="chip chip--accent">
                  <Check size={12} /> Активный
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await api.invoke('accounts:setActive', acc.id);
                    await load();
                  }}
                >
                  Выбрать
                </Button>
              )}
              <IconButton label="Удалить аккаунт" size="sm" ghost onClick={() => setDeleteId(acc.id)}>
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <div style={{ flex: 1 }}>
            <TextField value={nick} onChange={setNick} placeholder="Ник для офлайн-профиля" onEnter={addOffline} />
          </div>
          <Button variant="secondary" icon={<Plus size={15} />} onClick={addOffline} disabled={nick.trim().length < 3}>
            Добавить офлайн
          </Button>
        </div>
        <p className="tiny muted">
          Ник: 3–16 символов, латиница, цифры и «_». Офлайн-скин видят другие игроки только на серверах с
          плагинами/модами синхронизации скинов — правила Mojang это не позволяют обойти на обычных серверах.
        </p>
      </Section>

      <ConfirmDialog
        open={!!deleteId}
        title="Удалить аккаунт?"
        confirmLabel="Удалить"
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          const name = accounts.find((a) => a.id === deleteId)?.name ?? '';
          await api.invoke('accounts:remove', deleteId);
          setDeleteId(null);
          await load();
          toast('info', 'Аккаунт удалён', name);
        }}
      >
        <p>
          Аккаунт и его сохранённые токены будут удалены с этого компьютера. Сборки, миры и настройки не
          затрагиваются.
        </p>
      </ConfirmDialog>

      <Modal
        open={!!device}
        onClose={() => setDevice(null)}
        title="Вход через Microsoft"
        actions={
          <Button variant="secondary" onClick={() => setDevice(null)}>
            {waiting ? 'Отменить' : 'Закрыть'}
          </Button>
        }
      >
        {device && (
          <>
            <p>
              Откройте страницу <span className="mono">{device.verificationUri}</span> и введите код:
            </p>
            <div className="device-code">
              <span className="device-code__code">{device.userCode}</span>
              <div className="row" style={{ gap: 8 }}>
                <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyCode}>
                  {copied ? 'Скопировано' : 'Копировать код'}
                </Button>
                <Button size="sm" onClick={() => api.shell.openExternal(device.verificationUri)}>
                  Открыть страницу
                </Button>
              </div>
            </div>
            {waiting && (
              <div className="row" style={{ gap: 8, color: 'var(--text-muted)' }}>
                <Loader2 size={15} className="spin" /> Ждём подтверждения в браузере…
              </div>
            )}
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <p className="tiny muted">
              Код действует около 15 минут. Пароль вводится только на сайте Microsoft — лаунчер его не видит.
            </p>
          </>
        )}
      </Modal>
      <style>{`.spin{animation:spin 900ms linear infinite}`}</style>
    </>
  );
}