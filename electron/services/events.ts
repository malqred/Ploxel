import type { DownloadTask } from '../../shared/types';

type Broadcaster = (channel: string, payload?: unknown) => void;
type Listener = (payload: unknown) => void;

let broadcaster: Broadcaster | null = null;
/** Подписчики внутри главного процесса (например, статус в Discord) */
const listeners = new Map<string, Set<Listener>>();

export function setBroadcaster(fn: Broadcaster) {
  broadcaster = fn;
}

export function emit(channel: string, payload?: unknown) {
  broadcaster?.(channel, payload);
  for (const fn of listeners.get(channel) ?? []) {
    try {
      fn(payload);
    } catch (e) {
      console.warn(`[events] обработчик ${channel} упал`, e);
    }
  }
}

/** Подписка на событие внутри главного процесса; возвращает отписку. */
export function onEvent(channel: string, fn: Listener): () => void {
  const set = listeners.get(channel) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(channel, set);
  return () => set.delete(fn);
}

export type { DownloadTask };
