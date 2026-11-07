// Статус в Discord («Играет в Ploxel: сборка, версия»). Подключение к Discord
// на этом компьютере через его локальный канал; Discord не запущен — ничего
// не происходит. Нужен ID приложения Discord в config.json (discordClientId).

import net from 'node:net';
import { app } from 'electron';
import crypto from 'node:crypto';
import { getConfig } from './config';
import { loadSettings } from './settings';
import { readInstance } from './instances';
import { onEvent } from './events';
import { OP, buildActivity, decodeFrames, encodeFrame, pipePath } from '../core/discord-ipc';

const CONNECT_TIMEOUT = 3000;

/** Одно подключение к клиенту Discord. */
export class DiscordClient {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly clientId: string,
    private readonly paths: string[] = Array.from({ length: 10 }, (_, i) => pipePath(i))
  ) {}

  get connected(): boolean {
    return !!this.socket && !this.socket.destroyed;
  }

  /** Подключается к первому отвечающему каналу и ждёт READY от Discord. */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    for (const p of this.paths) {
      const socket = await openSocket(p);
      if (!socket) continue;
      if (await this.handshake(socket)) return true;
      socket.destroy();
    }
    return false;
  }

  private handshake(socket: net.Socket): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        socket.off('data', onData);
        if (ok) this.attach(socket);
        resolve(ok);
      };
      let pending: Buffer = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
        pending = rest;
        for (const f of frames) {
          const evt = (f.data as { evt?: string } | null)?.evt;
          if (f.op === OP.FRAME && evt === 'READY') return finish(true);
          if (f.op === OP.CLOSE || evt === 'ERROR') return finish(false);
        }
      };
      socket.on('data', onData);
      socket.once('close', () => finish(false));
      socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
  }

  private attach(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = decodeFrames(Buffer.concat([this.buffer, chunk]));
      this.buffer = rest;
      for (const f of frames) if (f.op === OP.PING) socket.write(encodeFrame(OP.PONG, f.data));
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
    });
    socket.on('error', () => socket.destroy());
  }

  /** null — убрать статус. */
  setActivity(activity: object | null): void {
    if (!this.connected) return;
    this.socket!.write(
      encodeFrame(OP.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: activity ?? undefined },
        nonce: crypto.randomUUID()
      })
    );
  }

  /**
   * Закрыть соединение после отправки уже записанного (в том числе «снять статус»)
   * и с кадром CLOSE: при обрыве через destroy() последний кадр мог не уйти, и статус
   * «Играет» оставался висеть в профиле.
   */
  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.destroyed) return;
    socket.end(encodeFrame(OP.CLOSE, {}));
    setTimeout(() => socket.destroy(), 1000).unref();
  }
}

function openSocket(p: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(p);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, CONNECT_TIMEOUT);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
  });
}

/* ---------------------- Связка с запуском игры ---------------------- */

let client: DiscordClient | null = null;
/** Запущенные сборки и время старта: статус показывает последнюю запущенную */
const playing = new Map<string, number>();

export function discordConfigured(): boolean {
  return !!getConfig().discordClientId;
}

function enabled(): boolean {
  return discordConfigured() && loadSettings().general.discordPresence;
}

async function refresh(): Promise<void> {
  const last = [...playing.entries()].pop();
  if (!last || !enabled()) {
    if (process.env.PLOXEL_TRACE_DISCORD) console.log('[discord] статус снят');
    client?.setActivity(null);
    client?.close();
    client = null;
    return;
  }
  const instance = readInstance(last[0]);
  if (!instance) return;
  client ??= new DiscordClient(getConfig().discordClientId);
  if (!(await client.connect())) return; // Discord не запущен — статус просто не показываем
  client.setActivity(
    buildActivity({
      gameVersion: instance.gameVersion,
      loader: instance.loader.kind,
      startedAt: last[1],
      appVersion: app.getVersion()
    })
  );
  if (process.env.PLOXEL_TRACE_DISCORD) console.log('[discord] статус поставлен:', instance.gameVersion, instance.loader.kind);
}

// Обновления по очереди: два быстрых события не откроют два подключения
let queue: Promise<void> = Promise.resolve();
function schedule(): void {
  queue = queue.then(refresh).catch((e) => console.warn('[discord]', e));
}

/** Подписка на запуск и выход из игры. Вызывается один раз при старте лаунчера. */
export function initDiscordPresence(): void {
  onEvent('game:started', (p) => {
    playing.set((p as { instanceId: string }).instanceId, Date.now());
    schedule();
  });
  onEvent('game:exited', (p) => {
    playing.delete((p as { instanceId: string }).instanceId);
    schedule();
  });
  onEvent('settings:changed', schedule);
}
