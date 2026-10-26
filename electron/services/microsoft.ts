import { getConfig } from './config';
import { getSecret } from './secrets';
import { upsertMicrosoftAccount, getRefreshToken, getStoredAccount, listAccountViews } from './accounts';
import type { Account } from '../../shared/types';

const SCOPE = 'XboxLive.signin offline_access';
// Аккаунты Minecraft — всегда личные аккаунты Microsoft, поэтому начинаем с
// /consumers. /common оставлен запасным для регистраций «любые аккаунты».
// Приложения «только личные аккаунты» на /common отвечают разными кодами
// (9002346 — код устройства, 9002331 — продление, 50059 — токен), поэтому
// любой из них означает «попробуй другой тенант».
const TENANTS = ['consumers', 'common'] as const;
let preferredTenant: (typeof TENANTS)[number] = 'consumers';
const TENANT_MISMATCH = ['9002346', '9002331', '50059', '90002'];

export function isTenantMismatch(json: Record<string, unknown>): boolean {
  const raw = `${json.error_description ?? ''} ${JSON.stringify(json.error_codes ?? '')}`;
  return TENANT_MISMATCH.some((code) => raw.includes(code));
}

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  tenant: string;
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
  uuid: string;
  name: string;
}

const tokenCache = new Map<string, TokenCacheEntry>();

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function clientId(): string {
  // ID, вшитый в установщик, главнее: устаревший ID из старых настроек ломал вход
  const id = getConfig().microsoftClientId || getSecret('ms-client-id');
  if (!id) {
    throw new AuthError(
      'NO_CLIENT_ID',
      'Вход через Microsoft недоступен в этой сборке лаунчера. Офлайн-профиль работает.'
    );
  }
  return id;
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok && !json.error) json.error = `HTTP ${res.status}`;
  return json;
}

async function postJson(url: string, body: unknown, token: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

/** Понятное объяснение кодов ошибок Microsoft. */
function describeAuthError(json: Record<string, unknown>): string {
  const raw = `${json.error_description ?? ''} ${json.error ?? ''} ${JSON.stringify(json.error_codes ?? '')}`;
  const code = raw.match(/AADSTS(\d+)/)?.[1] ?? '';
  const map: Record<string, string> = {
    '7000218':
      'В приложении Microsoft не включён вход без секрета. Откройте Entra ID → App registrations → ваше приложение → Authentication → Advanced settings → «Allow public client flows» = Yes, сохраните и попробуйте снова.',
    '700016': 'Неверный ID приложения Microsoft (client_id). Проверьте config.json.',
    '65001': 'Приложению не выдано согласие. Войдите ещё раз и подтвердите доступ.',
    '90002': 'Аккаунт не найден в указанном тенанте. Используйте личный аккаунт Microsoft.',
    '50059':
      'Microsoft не принял тип аккаунта. Войдите личным аккаунтом Microsoft, к которому привязан Minecraft. Если в браузере открыт рабочий или учебный аккаунт, откройте ссылку входа в приватном окне или выйдите из него и введите код ещё раз.',
    '9002313': 'Microsoft требует повторного входа. Начните вход заново.',
    '9002331': 'Сессия этого аккаунта устарела. Войдите через Microsoft ещё раз.',
    '9002346': 'Сессия этого аккаунта устарела. Войдите через Microsoft ещё раз.'
  };
  const hint = code && map[code] ? map[code] : '';
  if (hint) return code ? `${hint} (AADSTS${code})` : hint;
  if (String(json.error) === 'invalid_client') {
    return 'Microsoft не принял приложение (invalid_client). Проверьте microsoftClientId и включённый public client flow.';
  }
  const desc = String(json.error_description ?? '');
  return desc || 'Не удалось войти через Microsoft. Попробуйте ещё раз.';
}

/**
 * Понятная ошибка по ответу Minecraft Services. Раньше любой отказ считался
 * «нет купленной игры», хотя чаще всего это значило, что Mojang ещё не
 * одобрил приложение лаунчера (403 «Invalid app registration»).
 */
export function describeMinecraftError(status: number, body: Record<string, unknown>, step: 'login' | 'profile'): AuthError {
  const raw = `${body.errorMessage ?? ''} ${body.error ?? ''} ${body.errorType ?? ''} ${body.developerMessage ?? ''}`;
  if (/invalid app registration|AppRegInfo/i.test(raw) || (step === 'login' && status === 403)) {
    return new AuthError(
      'APP_NOT_APPROVED',
      'Вход через Microsoft пока не работает: Mojang ещё не одобрил приложение Ploxel. С вашим аккаунтом всё в порядке — вход заработает сам после одобрения. Пока можно играть с офлайн-профилем.'
    );
  }
  if (status === 429) {
    return new AuthError('RATE_LIMIT', 'Слишком много попыток входа. Подождите пару минут и попробуйте снова.');
  }
  if (step === 'profile' && (status === 404 || /NOT_FOUND/i.test(raw))) {
    return new AuthError('NO_GAME', 'На этом аккаунте Microsoft нет Minecraft: Java Edition (или у него ещё не создан ник на minecraft.net).');
  }
  if (status >= 500) {
    return new AuthError('MC_DOWN', 'Сервера Minecraft сейчас не отвечают. Попробуйте позже.');
  }
  const msg = String(body.errorMessage ?? '').trim();
  return new AuthError('MC', msg ? `Minecraft не принял вход: ${msg} (HTTP ${status})` : `Minecraft не принял вход (HTTP ${status}).`);
}

export async function startDeviceLogin(): Promise<DeviceCodeInfo> {
  console.log('[auth] device code: запрос у Microsoft');
  const order = [preferredTenant, ...TENANTS.filter((t) => t !== preferredTenant)];
  let last: Record<string, unknown> | null = null;
  for (const tenant of order) {
    const json = await postForm(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, {
      client_id: clientId(),
      scope: SCOPE
    });
    if (json.device_code) {
      preferredTenant = tenant;
      console.log('[auth] device code получен, tenant:', tenant);
      return {
        deviceCode: String(json.device_code),
        userCode: String(json.user_code),
        verificationUri: String(json.verification_uri),
        expiresIn: Number(json.expires_in ?? 900),
        interval: Number(json.interval ?? 5),
        tenant
      };
    }
    last = json;
    if (!isTenantMismatch(json)) break;
    console.warn('[auth] тенант', tenant, 'не подошёл, пробуем другой');
  }
  throw new AuthError('DEVICE_CODE', describeAuthError(last ?? {}));
}

/** Ожидает подтверждения входа и возвращает аккаунт. */
export async function waitForLogin(deviceCode: string, intervalSec: number, tenant = 'common'): Promise<Account> {
  const deadline = Date.now() + 16 * 60 * 1000;
  if (!TENANTS.includes(tenant as (typeof TENANTS)[number])) tenant = preferredTenant;
  let interval = Math.max(2, intervalSec);
  const tenants = [tenant, ...TENANTS.filter((t) => t !== tenant)];
  let tenantIndex = 0;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const json = await postForm(`https://login.microsoftonline.com/${tenants[tenantIndex]}/oauth2/v2.0/token`, {
      client_id: clientId(),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode
    });
    if (json.access_token) {
      preferredTenant = tenants[tenantIndex] as (typeof TENANTS)[number];
      return finishLogin(
        String(json.access_token),
        String(json.refresh_token ?? ''),
        Number(json.expires_in ?? 3600)
      );
    }
    const err = String(json.error ?? '');
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') {
      interval += 2;
      continue;
    }
    if (err === 'authorization_declined') throw new AuthError('DECLINED', 'Вход отменён в браузере.');
    if (err === 'expired_token') throw new AuthError('EXPIRED', 'Время входа истекло. Начните заново.');

    const desc = String(json.error_description ?? '');
    // Приложение может требовать другой тенант — пробуем второй endpoint.
    if (isTenantMismatch(json) && tenantIndex < tenants.length - 1) {
      console.warn('[auth] tenant', tenants[tenantIndex], 'не подошёл, пробуем', tenants[tenantIndex + 1]);
      tenantIndex++;
      continue;
    }
    console.warn('[auth] token ошибка', err, desc);
    throw new AuthError('TOKEN', describeAuthError(json));
  }
  throw new AuthError('EXPIRED', 'Время входа истекло. Начните заново.');
}

async function finishLogin(msAccessToken: string, refreshToken: string, expiresIn: number): Promise<Account> {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  }, '');
  const xblToken = xbl.Token as string | undefined;
  if (!xblToken) {
    console.warn('[auth] XBL отказ', JSON.stringify(xbl).slice(0, 400));
    throw new AuthError('XBL', 'Xbox Live отклонил вход. Проверьте, что у аккаунта есть профиль Xbox (xbox.com).');
  }
  console.log('[auth] XBL ок');

  const xstsRes = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  });
  const xsts = (await xstsRes.json()) as Record<string, unknown>;
  if (!xsts.Token) {
    const xerr = String(xsts.XErr ?? '');
    const hints: Record<string, string> = {
      '2148916233': 'У этого аккаунта Microsoft нет профиля Xbox — создайте его на xbox.com.',
      '2148916238': 'Аккаунт несовершеннолетний и требует семейного согласия.',
      '2148916227': 'Аккаунт Xbox заблокирован.'
    };
    throw new AuthError('XSTS', hints[xerr] ?? `Xbox Live: ошибка ${xerr || 'авторизации'}`);
  }
  const uhs = ((xsts.DisplayClaims as { xui: { uhs: string }[] })?.xui?.[0]?.uhs) ?? '';

  const mcRes = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${String(xsts.Token)}` })
  });
  const mc = (await mcRes.json().catch(() => ({}))) as Record<string, unknown>;
  const mcToken = String(mc.access_token ?? '');
  if (!mcToken) {
    console.warn('[auth] Minecraft отказ', mcRes.status, JSON.stringify(mc).slice(0, 400));
    throw describeMinecraftError(mcRes.status, mc, 'login');
  }
  console.log('[auth] Minecraft-токен получен');

  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcToken}` }
  });
  if (!profileRes.ok) {
    const body = (await profileRes.json().catch(() => ({}))) as Record<string, unknown>;
    console.warn('[auth] профиль Minecraft', profileRes.status, JSON.stringify(body).slice(0, 400));
    throw describeMinecraftError(profileRes.status, body, 'profile');
  }
  const profile = (await profileRes.json()) as { id?: string; name?: string; skins?: { url: string }[] };

  const account = upsertMicrosoftAccount({
    name: profile.name ?? 'Player',
    uuid: formatUuid(profile.id ?? ''),
    refreshToken,
    expiresAt: new Date(Date.now() + Number(mc.expires_in ?? expiresIn) * 1000).toISOString(),
    skinUrl: profile.skins?.[0]?.url
  });
  tokenCache.set(account.id, {
    accessToken: mcToken,
    expiresAt: Date.now() + Number(mc.expires_in ?? expiresIn) * 1000 - 60_000,
    uuid: account.uuid,
    name: account.name
  });
  return account;
}

/** Продлевает сессию по сохранённому refresh-токену. */
export async function refreshAccount(accountId: string): Promise<Account> {
  const refresh = getRefreshToken(accountId);
  if (!refresh) throw new AuthError('NO_REFRESH', 'Сессия истекла — войдите заново.');
  let last: Record<string, unknown> = {};
  for (const tenant of [preferredTenant, ...TENANTS.filter((t) => t !== preferredTenant)]) {
    const json = await postForm(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      client_id: clientId(),
      grant_type: 'refresh_token',
      refresh_token: refresh,
      scope: SCOPE
    });
    if (json.access_token) {
      preferredTenant = tenant;
      return finishLogin(String(json.access_token), String(json.refresh_token ?? refresh), Number(json.expires_in ?? 3600));
    }
    last = json;
    if (!isTenantMismatch(json)) break;
  }
  console.warn('[auth] refresh ошибка', last.error, last.error_description);
  throw new AuthError('REFRESH', describeAuthError(last));
}

/** Действующий токен Minecraft для запуска игры. */
export async function getMinecraftToken(accountId: string): Promise<{ accessToken: string; uuid: string; name: string }> {
  const cached = tokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const account = getStoredAccount(accountId);
  if (!account) throw new AuthError('NO_ACCOUNT', 'Аккаунт не найден.');
  if (account.type === 'offline') {
    return { accessToken: 'offline', uuid: account.uuid, name: account.name };
  }
  await refreshAccount(accountId);
  const fresh = tokenCache.get(accountId);
  if (!fresh) throw new AuthError('REFRESH', 'Не удалось получить токен. Войдите заново.');
  return fresh;
}

/** В фоне продлевает сессии Microsoft, у которых истёк или истекает токен. */
export async function refreshExpiredAccounts(): Promise<number> {
  let refreshed = 0;
  const soon = Date.now() + 10 * 60 * 1000;
  for (const acc of listAccountViews()) {
    if (acc.type !== 'microsoft') continue;
    const expires = acc.expiresAt ? new Date(acc.expiresAt).getTime() : 0;
    if (expires > soon) continue;
    if (!getRefreshToken(acc.id)) continue;
    try {
      await refreshAccount(acc.id);
      refreshed++;
    } catch (e) {
      console.warn('[auth] не удалось продлить сессию', acc.name, e instanceof Error ? e.message : e);
    }
  }
  return refreshed;
}

export function formatUuid(raw: string): string {
  const h = raw.replace(/-/g, '');
  if (h.length !== 32) return raw;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}