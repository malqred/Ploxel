// Очистка лога перед отправкой наружу (ИИ, mclo.gs): ник, домашняя папка,
// токены, IP-адреса и UUID заменяются метками.

export interface SanitizeOptions {
  /**
   * Оставить пути (без домашней папки пользователя). Человеку, который помогает
   * по ссылке на лог, путь к файлу мода нужен; ИИ он не нужен — там пути режутся целиком.
   */
  keepPaths?: boolean;
}

export function sanitizeLog(text: string, nick?: string, opts: SanitizeOptions = {}): string {
  let out = text;
  if (nick && nick.length >= 3) {
    out = out.replaceAll(nick, '<ник>');
  }
  // Windows: C:\Users\Имя (и C:/Users/Имя) — папка пользователя с его именем
  out = out.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/gi, '<дом>');
  // Остальные абсолютные пути Windows
  if (!opts.keepPaths) out = out.replace(/[A-Za-z]:\\(?:[^\\\s:*?"<>|]+\\)*[^\\\s:*?"<>|]*/g, '<путь>');
  // POSIX home
  out = out.replace(/\/(?:home|Users)\/[^\s/]+/g, '<дом>');
  // Токены и ключи
  out = out.replace(/(accessToken|access_token|session|token|Bearer)[=:\s]+[A-Za-z0-9._~+/=-]{12,}/gi, '$1=<скрыто>');
  out = out.replace(/\b[0-9a-f]{32}\b/gi, '<id>');
  // IP-адреса (серверы/локальная сеть)
  out = out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>');
  // UUID
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
  return out;
}
