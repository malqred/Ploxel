import crypto from 'node:crypto';
import { getRefreshToken, getStoredAccount, updateAccountSecret, upsertElyAccount } from './accounts';
import { describeElyError, elyTexturesUrl, formatElyUuid } from '../core/elyby';
import type { Account } from '../../shared/types';

/**
 * Вход через Ely.by (сервер авторизации, совместимый с Mojang Yggdrasil).
 * Пароль уходит только на authserver.ely.by и нигде не хранится: лаунчер
 * сохраняет зашифрованные accessToken и clientToken, а перед запуском игры
 * проверяет и при необходимости продлевает их.
 * Документация: https://docs.ely.by/en/minecraft-auth.html
 */

const AUTH = 'https://authserver.ely.by/auth';
/** Токены Ely.by живут долго; для интерфейса считаем сессию свежей неделю. */
const SESSION_DAYS = 7;

export class ElyAuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface ElySecret {
  accessToken: string;
  clientToken: string;
}

interface ElyAuthResponse {
  accessToken?: string;
  clientToken?: string;
  selectedProfile?: { id: string; name: string };
  error?: string;
  errorMessage?: string;
}

async function post(endpoint: string, body: unknown): Promise<{ status: number; json: ElyAuthResponse }> {
  let res: Response;
  try {
    res = await fetch(`${AUTH}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new ElyAuthError('NETWORK', 'Сервер Ely.by не отвечает. Проверьте интернет и попробуйте ещё раз.');
  }
  const text = await res.text();
  let json: ElyAuthResponse = {};
  try {
    json = text ? (JSON.parse(text) as ElyAuthResponse) : {};
  } catch {
    /* пустой или не-JSON ответ (validate отвечает пустым телом) */
  }
  return { status: res.status, json };
}

const expires = () => new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();

/** Адрес текущего скина игрока (у кого скина нет — undefined). */
export async function resolveElySkin(name: string): Promise<string | undefined> {
  const url = elyTexturesUrl(name);
  if (!url) return undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { SKIN?: { url?: string } };
    return json.SKIN?.url;
  } catch {
    return undefined;
  }
}

/** Вход по логину (ник или e-mail) и паролю; totp — код двухфакторной защиты. */
export async function loginElyBy(login: string, password: string, totp?: string): Promise<Account> {
  const username = login.trim();
  if (!username || !password) throw new ElyAuthError('EMPTY', 'Введите логин и пароль от Ely.by.');
  const clientToken = crypto.randomUUID();
  const code = totp?.replace(/\s/g, '');
  const { status, json } = await post('authenticate', {
    username,
    password: code ? `${password}:${code}` : password,
    clientToken,
    requestUser: true
  });
  if (status !== 200 || !json.accessToken || !json.selectedProfile) {
    const err = describeElyError(status, json.errorMessage ?? json.error ?? '');
    throw new ElyAuthError(err.code, err.message);
  }
  const profile = json.selectedProfile;
  const secret: ElySecret = { accessToken: json.accessToken, clientToken: json.clientToken ?? clientToken };
  return upsertElyAccount({
    name: profile.name,
    uuid: formatElyUuid(profile.id),
    secret: JSON.stringify(secret),
    expiresAt: expires(),
    skinUrl: await resolveElySkin(profile.name)
  });
}

/** Рабочий токен для запуска игры: проверяем, при необходимости продлеваем. */
export async function getElyToken(accountId: string): Promise<{ accessToken: string; uuid: string; name: string }> {
  const account = getStoredAccount(accountId);
  if (!account || account.type !== 'elyby') throw new ElyAuthError('NO_ACCOUNT', 'Аккаунт Ely.by не найден.');
  const raw = getRefreshToken(accountId);
  let secret: ElySecret | null = null;
  try {
    secret = raw ? (JSON.parse(raw) as ElySecret) : null;
  } catch {
    secret = null;
  }
  if (!secret?.accessToken) throw new ElyAuthError('RELOGIN', 'Сессия Ely.by потеряна — войдите заново.');

  const valid = await post('validate', { accessToken: secret.accessToken });
  if (valid.status === 200) return { accessToken: secret.accessToken, uuid: account.uuid, name: account.name };

  const { status, json } = await post('refresh', {
    accessToken: secret.accessToken,
    clientToken: secret.clientToken,
    requestUser: true
  });
  if (status !== 200 || !json.accessToken) {
    throw new ElyAuthError('RELOGIN', 'Сессия Ely.by истекла — войдите заново (Настройки → Аккаунты).');
  }
  const next: ElySecret = { accessToken: json.accessToken, clientToken: json.clientToken ?? secret.clientToken };
  updateAccountSecret(accountId, JSON.stringify(next), expires());
  return {
    accessToken: next.accessToken,
    uuid: json.selectedProfile ? formatElyUuid(json.selectedProfile.id) : account.uuid,
    name: json.selectedProfile?.name ?? account.name
  };
}

/** Выход: токен отзывается на сервере (если получится), аккаунт удаляет вызывающий. */
export async function signOutElyBy(accountId: string): Promise<void> {
  try {
    const raw = getRefreshToken(accountId);
    const secret = raw ? (JSON.parse(raw) as ElySecret) : null;
    if (secret) await post('invalidate', { accessToken: secret.accessToken, clientToken: secret.clientToken });
  } catch {
    /* без сети — токен истечёт сам */
  }
}
