// Протокол локального IPC Discord (Rich Presence): кадр = код операции (int32 LE),
// длина (int32 LE) и JSON. Без сторонних библиотек — протокол из пяти кадров.

export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

export interface Frame {
  op: number;
  data: unknown;
}

/** Читает все целые кадры из буфера; остаток (неполный кадр) возвращается. */
export function decodeFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const op = buffer.readInt32LE(offset);
    const len = buffer.readInt32LE(offset + 4);
    if (len < 0 || buffer.length - offset - 8 < len) break;
    const body = buffer.subarray(offset + 8, offset + 8 + len).toString('utf8');
    let data: unknown = null;
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
    frames.push({ op, data });
    offset += 8 + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/** Что видно в статусе. Название сборки не передаётся: пользователь не хочет его показывать. */
export interface PresenceInput {
  gameVersion: string;
  loader: string;
  startedAt: number;
  /** версия лаунчера: входит в ссылку на картинку, чтобы Discord не показывал старую из кэша */
  appVersion?: string;
}

const LOADER_NAME: Record<string, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
};

/** Строки Discord — от 2 до 128 символов. */
function clip(text: string): string {
  const t = text.trim();
  if (t.length < 2) return `${t}  `.slice(0, 2);
  return t.length > 128 ? `${t.slice(0, 127)}…` : t;
}

/**
 * Картинка статуса — по ссылке: Discord сам забирает её через свой прокси (mp:external),
 * загружать её в Art Assets приложения не нужно. Иконка лежит в репозитории лаунчера.
 */
export const PRESENCE_IMAGE = 'https://raw.githubusercontent.com/malqred/Ploxel/main/build/icon.png';

/**
 * Ссылка на картинку статуса. Discord кэширует картинку по ссылке: после смены иконки
 * он продолжал бы показывать старую, поэтому в ссылке — версия лаунчера.
 */
export function presenceImage(appVersion?: string): string {
  return appVersion ? `${PRESENCE_IMAGE}?v=${encodeURIComponent(appVersion)}` : PRESENCE_IMAGE;
}

/** Активность «Играет»: версия игры, загрузчик и время с начала игры. */
export function buildActivity(input: PresenceInput) {
  return {
    details: clip(`Minecraft ${input.gameVersion}`),
    state: clip(LOADER_NAME[input.loader] ?? input.loader),
    timestamps: { start: Math.floor(input.startedAt / 1000) },
    assets: { large_image: presenceImage(input.appVersion), large_text: 'Ploxel' },
    instance: false
  };
}

/** Имя канала Discord в Windows и других системах. */
export function pipePath(index: number, platform = process.platform, env = process.env): string {
  if (platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`;
  const dir = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  return `${dir.replace(/\/$/, '')}/discord-ipc-${index}`;
}
