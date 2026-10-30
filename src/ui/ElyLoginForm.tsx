import { useState } from 'react';
import { ExternalLink, LogIn } from 'lucide-react';
import { api } from '../api';
import { Button } from './Button';
import { TextField } from './TextField';
import type { Account } from '../../shared/types';

type LoginResult = { ok: true; account: Account } | { ok: false; code: string; message: string };

/**
 * Вход через Ely.by: логин и пароль уходят только на сервер Ely.by,
 * лаунчер хранит зашифрованный токен сессии, а не пароль.
 */
export function ElyLoginForm({ onDone }: { onDone: (account: Account) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!login.trim() || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.invoke<LoginResult>('auth:ely:login', login, password, needTotp ? totp : undefined);
      if (res.ok) {
        setPassword('');
        setTotp('');
        setNeedTotp(false);
        onDone(res.account);
        return;
      }
      if (res.code === 'TOTP') setNeedTotp(true);
      setError(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <TextField value={login} onChange={setLogin} placeholder="Ник или e-mail Ely.by" onEnter={submit} />
      <TextField value={password} onChange={setPassword} placeholder="Пароль" type="password" onEnter={submit} />
      {needTotp && (
        <TextField value={totp} onChange={setTotp} placeholder="Код из приложения (6 цифр)" onEnter={submit} />
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <Button
          variant="secondary"
          icon={<LogIn size={16} />}
          loading={busy}
          disabled={!login.trim() || !password || (needTotp && totp.trim().length < 6)}
          onClick={submit}
        >
          Войти через Ely.by
        </Button>
        <Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} onClick={() => api.shell.openExternal('https://account.ely.by/register')}>
          Создать аккаунт
        </Button>
      </div>
      {error && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      <p className="tiny muted" style={{ margin: 0 }}>
        Пароль отправляется только на сервер Ely.by и не сохраняется. Скин меняется на сайте ely.by — в игре его
        увидят игроки с Ely.by и серверы с его поддержкой.
      </p>
    </div>
  );
}
