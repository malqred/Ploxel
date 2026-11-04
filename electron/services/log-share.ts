// «Поделиться логом»: очищенный лог загружается на mclo.gs — сервис для логов
// Minecraft, которым пользуются Prism Launcher и Modrinth App. Отправка только
// после предпросмотра в окне и нажатия кнопки пользователем.

import { sanitizeLog } from '../core/log-sanitize';
import type { SharedLog } from '../../shared/types';

const API = 'https://api.mclo.gs/1';
/** Ограничения mclo.gs: 10 МБ и 25 000 строк — берём последние строки с запасом */
const MAX_LINES = 25000;
const MAX_BYTES = 9 * 1024 * 1024;

/** Текст, который уйдёт на mclo.gs: очищенный и обрезанный под ограничения сервиса. */
export function prepareSharedLog(raw: string, nick?: string): string {
  let text = sanitizeLog(raw, nick, { keepPaths: true });
  const lines = text.split('\n');
  if (lines.length > MAX_LINES) text = lines.slice(-MAX_LINES).join('\n');
  while (Buffer.byteLength(text, 'utf8') > MAX_BYTES) text = text.slice(Math.floor(text.length / 10));
  return text;
}

/** Загружает уже показанный пользователю текст; возвращает ссылку на лог. */
export async function uploadLog(text: string): Promise<SharedLog> {
  if (!text.trim()) throw new Error('Лог пуст — сначала запустите игру.');
  const res = await fetch(`${API}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, source: 'Ploxel' }),
    signal: AbortSignal.timeout(30000)
  });
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; url?: string; id?: string; token?: string; error?: string }
    | null;
  if (!res.ok || !json?.success || !json.url || !json.id) {
    throw new Error(`mclo.gs не принял лог${json?.error ? `: ${json.error}` : ` (HTTP ${res.status})`}`);
  }
  return { url: json.url, id: json.id, token: json.token };
}

/** Удаляет загруженный лог с mclo.gs по ключу, выданному при загрузке. */
export async function deleteSharedLog(id: string, token: string): Promise<void> {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Неверный id лога');
  const res = await fetch(`${API}/log/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000)
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  if (!res.ok || json?.success === false) throw new Error(`mclo.gs не удалил лог${json?.error ? `: ${json.error}` : ''}`);
}
