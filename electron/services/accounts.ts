import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeStorage } from 'electron';
import { getRoot } from './paths';
import { offlineUuid } from '../core/uuid';
import type { Account, AccountView } from '../../shared/types';

interface StoredAccount extends Account {
  /** зашифрованный refresh-токен (DPAPI через safeStorage) */
  refresh?: string;
  msAccountId?: string;
}

interface AccountsFile {
  schemaVersion: number;
  activeId: string | null;
  accounts: StoredAccount[];
}

const FILE = 'accounts.json';

function filePath() {
  return path.join(getRoot(), FILE);
}

function empty(): AccountsFile {
  return { schemaVersion: 1, activeId: null, accounts: [] };
}

function read(): AccountsFile {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as AccountsFile;
    if (!Array.isArray(data.accounts)) return empty();
    return data;
  } catch {
    return empty();
  }
}

function write(data: AccountsFile) {
  const tmp = filePath() + '.tmp';
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath());
}

export function listAccounts(): Account[] {
  return read().accounts.map(publicView);
}

/** Аккаунты со статусом сессии — для интерфейса. */
export function listAccountViews(): AccountView[] {
  return read().accounts.map((a) => ({
    ...publicView(a),
    sessionState:
      a.type === 'offline'
        ? 'offline'
        : a.type === 'elyby'
          ? (a.refresh ? 'valid' : 'expired')
        : a.expiresAt && new Date(a.expiresAt).getTime() > Date.now()
          ? 'valid'
          : 'expired'
  }));
}

export function activeAccount(): Account | null {
  const data = read();
  const acc = data.accounts.find((a) => a.id === data.activeId) ?? data.accounts[0];
  return acc ? publicView(acc) : null;
}

export function setActiveAccount(id: string): Account | null {
  const data = read();
  if (!data.accounts.some((a) => a.id === id)) return null;
  data.activeId = id;
  write(data);
  return activeAccount();
}

export function removeAccount(id: string): Account[] {
  const data = read();
  data.accounts = data.accounts.filter((a) => a.id !== id);
  if (data.activeId === id) data.activeId = data.accounts[0]?.id ?? null;
  write(data);
  return listAccounts();
}

export function addOfflineAccount(name: string): Account {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Пустой ник');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
    throw new Error('Ник: 3–16 символов, латиница, цифры и подчёркивание');
  }
  const data = read();
  const existing = data.accounts.find((a) => a.type === 'offline' && a.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    data.activeId = existing.id;
    write(data);
    return publicView(existing);
  }
  const account: StoredAccount = {
    id: crypto.randomUUID(),
    type: 'offline',
    name: trimmed,
    uuid: offlineUuid(trimmed),
    createdAt: new Date().toISOString()
  };
  data.accounts.push(account);
  data.activeId = account.id;
  write(data);
  return publicView(account);
}

export function upsertMicrosoftAccount(input: {
  name: string;
  uuid: string;
  msAccountId?: string;
  refreshToken?: string;
  expiresAt?: string;
  skinUrl?: string;
}): Account {
  const data = read();
  const match = data.accounts.find(
    (a) => a.type === 'microsoft' && (a.uuid === input.uuid || (input.msAccountId && a.msAccountId === input.msAccountId))
  );
  const stored: StoredAccount = match ?? {
    id: crypto.randomUUID(),
    type: 'microsoft',
    name: input.name,
    uuid: input.uuid,
    createdAt: new Date().toISOString()
  };
  stored.name = input.name;
  stored.uuid = input.uuid;
  stored.msAccountId = input.msAccountId ?? stored.msAccountId;
  stored.expiresAt = input.expiresAt ?? stored.expiresAt;
  stored.skinUrl = input.skinUrl ?? stored.skinUrl;
  if (input.refreshToken) stored.refresh = encrypt(input.refreshToken);
  if (!match) data.accounts.push(stored);
  data.activeId = stored.id;
  write(data);
  return publicView(stored);
}

/**
 * Аккаунт Ely.by: secret — зашифрованные токены сессии (не пароль).
 * Совпадение по UUID — тот же аккаунт, просто новый вход.
 */
export function upsertElyAccount(input: { name: string; uuid: string; secret: string; expiresAt: string; skinUrl?: string }): Account {
  const data = read();
  const match = data.accounts.find((a) => a.type === 'elyby' && a.uuid === input.uuid);
  const stored: StoredAccount = match ?? {
    id: crypto.randomUUID(),
    type: 'elyby',
    name: input.name,
    uuid: input.uuid,
    createdAt: new Date().toISOString()
  };
  stored.name = input.name;
  stored.expiresAt = input.expiresAt;
  stored.skinUrl = input.skinUrl;
  stored.refresh = encrypt(input.secret);
  if (!stored.refresh) throw new Error('Шифрование Windows недоступно — сохранить вход нельзя.');
  if (!match) data.accounts.push(stored);
  data.activeId = stored.id;
  write(data);
  return publicView(stored);
}

/** Обновить секрет и срок сессии существующего аккаунта (после продления токена). */
export function updateAccountSecret(id: string, secret: string, expiresAt: string): void {
  const data = read();
  const acc = data.accounts.find((a) => a.id === id);
  if (!acc) return;
  acc.refresh = encrypt(secret);
  acc.expiresAt = expiresAt;
  write(data);
}

/** Расшифрованный refresh-токен для продления сессии. Только внутри main. */
export function getRefreshToken(id: string): string | null {
  const acc = read().accounts.find((a) => a.id === id);
  if (!acc?.refresh) return null;
  return decrypt(acc.refresh);
}

export function getStoredAccount(id: string): Account | null {
  const acc = read().accounts.find((a) => a.id === id);
  return acc ? publicView(acc) : null;
}

function publicView(a: StoredAccount): Account {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    uuid: a.uuid,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
    skinUrl: secureSkinUrl(a.skinUrl)
  };
}

/**
 * Mojang отдаёт адреса текстур по http://, а окно лаунчера грузит картинки
 * только по https — из-за этого аватар аккаунта Microsoft не показывался.
 */
export function secureSkinUrl(url: string | undefined): string | undefined {
  return url ? url.replace(/^http:\/\//i,'https://') : url;
}

/** Обновить скин аккаунта после смены на серверах Mojang. */
export function setAccountSkinUrl(id: string, skinUrl: string | undefined): void {
  const data = read();
  const acc = data.accounts.find((a) => a.id === id);
  if (!acc) return;
  acc.skinUrl = skinUrl;
  write(data);
}

/** Активный скин из ответа /minecraft/profile. */
export function activeSkinUrl(profile: { skins?: { url: string; state?: string }[] } | null | undefined): string | undefined {
  const skins = profile?.skins ?? [];
  return (skins.find((s) => s.state === 'ACTIVE') ?? skins[0])?.url;
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return '';
  return safeStorage.encryptString(value).toString('base64');
}

function decrypt(value: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return null;
  }
}

/** UUID офлайн-игрока — как в Java: version 3 UUID от "OfflinePlayer:<ник>". */
export { offlineUuid } from '../core/uuid';