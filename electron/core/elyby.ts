/** Чистая логика Ely.by: тексты ошибок, UUID, адреса скинов. */

/** Адрес JSON с текстурами игрока (ник — латиница, цифры, «_» и «-»). */
export function elyTexturesUrl(name: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,32}$/.test(name) ? `https://skinsystem.ely.by/textures/${name}` : undefined;
}

/** UUID без дефисов → с дефисами. */
export function formatElyUuid(raw: string): string {
  const h = raw.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(h)) return raw;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();
}

/** Понятный текст по ответу authserver.ely.by. */
export function describeElyError(status: number, message: string): { code: string; message: string } {
  const m = message.toLowerCase();
  if (m.includes('two factor')) {
    return { code: 'TOTP', message: 'На аккаунте включена двухфакторная защита — введите код из приложения.' };
  }
  if (m.includes('invalid credentials') || m.includes('invalid nickname or password')) {
    return { code: 'CREDENTIALS', message: 'Неверный логин или пароль Ely.by.' };
  }
  if (m.includes('banned') || m.includes('suspended') || m.includes('deleted')) {
    return { code: 'BLOCKED', message: 'Аккаунт Ely.by заблокирован или удалён.' };
  }
  if (status === 429) return { code: 'RATE', message: 'Слишком много попыток входа. Подождите минуту.' };
  if (status >= 500) return { code: 'DOWN', message: 'Сервер Ely.by сейчас не работает. Попробуйте позже.' };
  return { code: 'AUTH', message: message ? `Ely.by не принял вход: ${message}` : 'Ely.by не принял вход.' };
}

/** Аргумент Java для authlib-injector: игра берёт ники и скины с Ely.by. */
export function elyJavaAgent(jarPath: string): string {
  return `-javaagent:${jarPath}=ely.by`;
}
