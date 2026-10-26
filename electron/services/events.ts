import type { DownloadTask } from '../../shared/types';

type Broadcaster = (channel: string, payload?: unknown) => void;

let broadcaster: Broadcaster | null = null;

export function setBroadcaster(fn: Broadcaster) {
  broadcaster = fn;
}

export function emit(channel: string, payload?: unknown) {
  broadcaster?.(channel, payload);
}

export type { DownloadTask };