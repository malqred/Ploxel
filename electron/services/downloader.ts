// Менеджер загрузок Ploxel: очередь с приоритетами, пауза/возобновление/отмена,
// ограничение параллелизма и скорости, докачка, Range-мультипоток, retry.
//
// Ограничения (сознательные):
//  - Сеть через global fetch (undici-совместимый). Он пулится keep-alive соединения
//    per origin, но HTTP/2 не использует (только HTTP/1.1). Без новых зависимостей.
//  - Системный прокси: если установлены HTTPS_PROXY/HTTP_PROXY и пакет undici
//    доступен в node_modules (транзитивная зависимость), создаём undici.ProxyAgent.
//    Если undici нет — молча работаем через системный fetch, ничего не ломая.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { emit as broadcast } from './events';
import type { DownloadTask } from '../../shared/types';

export interface DownloadItem {
  url: string;
  dest: string;
  sha1?: string;
  /** hex */
  sha256?: string;
  /** hex */
  sha512?: string;
  size?: number;
  priority?: 'high' | 'normal' | 'low';
  group?: string;
  /** потоки Range для этого файла (по умолчанию — из настроек загрузок) */
  threads?: number;
  /** название задачи в интерфейсе (по умолчанию — имя файла) */
  title?: string;
}

/** Сколько потоков Range брать для файла. */
function rangeThreadsFor(item: DownloadItem): number {
  return Math.max(0, Math.min(16, Math.floor(item.threads ?? config.rangeThreads)));
}

export interface DownloadConfig {
  /** сколько файлов качать одновременно */
  maxConcurrent: number;
  /** лимит суммарной скорости в КБ/с, 0 — без ограничения */
  speedLimitKbps: number;
  /** сколько потоков на крупный файл (0 — выключено) */
  rangeThreads: number;
  /** свои зеркала; пустая строка — использовать официальный адрес */
  mirrors: { mojang: string; modrinth: string; curseforge: string };
}

export interface DownloadStats {
  bytesDone: number;
  bytesTotal: number;
  speedBps: number;
  etaSeconds: number | null;
  running: number;
  queued: number;
}

const USER_AGENT = 'PloxelLauncher/0.5 (contact: local)';
/** файлы крупнее этого порога качаем Range-потоками, если включены */
const LARGE_FILE_MIN = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 4;
const HEADER_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 60_000;
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 4000;
const EMIT_THROTTLE_MS = 250;

export class CancelledError extends Error {
  constructor() {
    super('Отменено');
    this.name = 'CancelledError';
  }
}

/** Несоответствие размера/хэша — .part удаляется, загрузка повторяется заново. */
export class VerifyError extends Error {}

/** Сервер просит подождать (429 + Retry-After). */
class Throttle extends Error {
  constructor(readonly waitMs: number) {
    super('Сервер просит подождать (429)');
    this.name = 'Throttle';
  }
}

const config: DownloadConfig = {
  maxConcurrent: 6,
  speedLimitKbps: 0,
  rangeThreads: 0,
  mirrors: { mojang: '', modrinth: '', curseforge: '' }
};

/** Настроить глобальные параметры менеджера загрузок. */
export function configureDownloader(patch: Partial<DownloadConfig>) {
  if (typeof patch.maxConcurrent === 'number')
    config.maxConcurrent = Math.max(1, Math.min(64, Math.floor(patch.maxConcurrent)));
  if (typeof patch.speedLimitKbps === 'number') {
    config.speedLimitKbps = Math.max(0, patch.speedLimitKbps);
    pacer.setLimit(config.speedLimitKbps);
  }
  if (typeof patch.rangeThreads === 'number')
    config.rangeThreads = Math.max(0, Math.min(16, Math.floor(patch.rangeThreads)));
  if (patch.mirrors) {
    config.mirrors = {
      mojang: cleanMirror(patch.mirrors.mojang),
      modrinth: cleanMirror(patch.mirrors.modrinth),
      curseforge: cleanMirror(patch.mirrors.curseforge)
    };
  }
  schedule();
}

function cleanMirror(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v.replace(/\/$/, '') : `https://${v.replace(/\/$/, '')}`;
}

/** Подменяет официальный адрес на зеркало, если оно задано пользователем. */
function mirrorUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const group =
      /(^|\.)mojang\.com$/.test(host) || host === 'libraries.minecraft.net' || host === 'resources.download.minecraft.net'
        ? config.mirrors.mojang
        : /(^|\.)modrinth\.com$/.test(host)
          ? config.mirrors.modrinth
          : /(^|\.)forgecdn\.net$/.test(host) || /(^|\.)curseforge\.com$/.test(host)
            ? config.mirrors.curseforge
            : '';
    if (!group) return url;
    return `${group}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function getDownloaderConfig(): DownloadConfig {
  return { ...config };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(t);
      resolve();
    }
    function onAbort() {
      done();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* ------------------------- Ограничитель скорости ------------------------- */

/**
 * Глобальный token bucket на байты. Все потоки (и все Range-сегменты)
 * проходят через него, поэтому лимит честный для всего менеджера.
 */
class Pacer {
  private limitBps = 0;
  private tokens = 0;
  private last = 0;

  setLimit(kbps: number) {
    this.limitBps = kbps * 1000;
    this.tokens = this.limitBps;
    this.last = Date.now();
  }

  async take(n: number) {
    if (this.limitBps <= 0 || n <= 0) return;
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.limitBps, this.tokens + ((now - this.last) / 1000) * this.limitBps);
      this.last = now;
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }
      const wait = ((n - this.tokens) / this.limitBps) * 1000;
      await sleep(Math.min(Math.max(wait, 1), 200));
    }
  }
}

const pacer = new Pacer();

/* ------------------------------ Хэши файлов ------------------------------ */

interface HashSlot {
  name: 'sha1' | 'sha256' | 'sha512';
  expected: string;
  h: crypto.Hash;
}

function makeHashers(item: DownloadItem): HashSlot[] {
  const slots: HashSlot[] = [];
  if (item.sha1) slots.push({ name: 'sha1', expected: item.sha1.toLowerCase(), h: crypto.createHash('sha1') });
  if (item.sha256) slots.push({ name: 'sha256', expected: item.sha256.toLowerCase(), h: crypto.createHash('sha256') });
  if (item.sha512) slots.push({ name: 'sha512', expected: item.sha512.toLowerCase(), h: crypto.createHash('sha512') });
  return slots;
}

/**
 * Проверить хэши (а без них — размер). Бросает VerifyError при несоответствии.
 * Если хэш указан и совпал, файл верный, даже когда заявленный размер
 * ошибочен: в индексах модпаков встречается размер на байт меньше настоящего.
 */
export async function verifyFile(file: string, item: DownloadItem): Promise<void> {
  const stat = await fsp.stat(file);
  const hashed = !!(item.sha1 || item.sha256 || item.sha512);
  if (!hashed && item.size && stat.size !== item.size) {
    throw new VerifyError(
      `Размер не совпал: ожидалось ${item.size} байт, получено ${stat.size} (${path.basename(file)})`
    );
  }
  const slots = makeHashers(item);
  if (slots.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const st = fs.createReadStream(file);
    st.on('data', (c: Buffer) => {
      for (const s of slots) s.h.update(c);
    });
    st.on('error', (e) => reject(e));
    st.on('end', () => {
      const bad = slots.find((s) => s.h.digest('hex') !== s.expected);
      if (bad) reject(new VerifyError(`Хэш ${bad.name} не совпал: файл ${path.basename(file)} повреждён`));
      else resolve();
    });
  });
}

/** true, если файл уже на месте и соответствует размеру и хэшу (кэш). */
async function fileOkFull(file: string, item: DownloadItem): Promise<boolean> {
  try {
    await verifyFile(file, item);
    return true;
  } catch {
    return false;
  }
}

export function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function fileOk(file: string, sha1?: string, size?: number): Promise<boolean> {
  try {
    const stat = await fsp.stat(file);
    if (!sha1) return !size || stat.size === size;
    return (await sha1File(file)) === sha1.toLowerCase();
  } catch {
    return false;
  }
}

export async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const fn = await getFetch(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await fn(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* --------------------------- Сеть: fetch + прокси --------------------------- */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

let plainFetch: FetchFn | null = null;
const proxyFetches = new Map<string, FetchFn>();

/**
 * Глобальный fetch пулится keep-alive по origin (undici-стек), HTTP/2 не использует.
 * Если задан прокси через HTTPS_PROXY/HTTP_PROXY и undici доступен — ProxyAgent.
 */
async function getFetch(url: string): Promise<FetchFn> {
  const proxy = url.startsWith('https:')
    ? process.env.HTTPS_PROXY || process.env.https_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy) {
    if (!plainFetch) plainFetch = (u, i) => fetch(u, i);
    return plainFetch;
  }
  const cached = proxyFetches.get(proxy);
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const undici = (await import('undici')) as any;
    const dispatcher = new undici.ProxyAgent(proxy);
    const fn: FetchFn = (u, i) => undici.fetch(u, { ...i, dispatcher });
    proxyFetches.set(proxy, fn);
    return fn;
  } catch {
    // undici нет в node_modules — работаем через обычный fetch, ничего не ломаем.
    if (!plainFetch) plainFetch = (u, i) => fetch(u, i);
    return plainFetch;
  }
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get('retry-after');
  let ms = 1000;
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) ms = Math.max(0, secs) * 1000;
  }
  return Math.min(ms, 60_000);
}

interface OpenReq {
  res: Response;
  /** контроллер, который отменяет именно этот запрос (таймауты/обрыв) */
  ctrl: AbortController;
  /** сбросить watchdog «зависшего» соединения (вызывать на каждый чанк) */
  bump: () => void;
  cleanup: () => void;
}

/**
 * Открыть GET с таймаутом на ответ (30 с) и watchdog на зависшее соединение (60 с).
 * Внешний signal (отмена/пауза-менеджер) пробрасывается на этот запрос.
 */
async function openRequest(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<OpenReq> {
  const target = mirrorUrl(url);
  const fn = await getFetch(target);
  const ctrl = new AbortController();
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new CancelledError();
  const onOuterAbort = () => ctrl.abort(signal.reason);
  signal.addEventListener('abort', onOuterAbort, { once: true });
  let headerTimer: NodeJS.Timeout | undefined;
  let stallTimer: NodeJS.Timeout | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    signal.removeEventListener('abort', onOuterAbort);
    if (headerTimer) clearTimeout(headerTimer);
    if (stallTimer) clearTimeout(stallTimer);
  };
  headerTimer = setTimeout(() => ctrl.abort(new Error('Нет ответа от сервера (таймаут)')), HEADER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fn(target, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: ctrl.signal });
  } catch (e) {
    cleanup();
    if (ctrl.signal.aborted) {
      const r = ctrl.signal.reason;
      throw r instanceof Error ? r : new Error('Соединение оборвалось');
    }
    throw new Error(networkMessage(e));
  }
  clearTimeout(headerTimer);
  const bump = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () => ctrl.abort(new Error('Загрузка зависла: сервер не передаёт данные')),
      STALL_TIMEOUT_MS
    );
  };
  bump();
  return { res, ctrl, bump, cleanup };
}

function networkMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (!m || m === 'fetch failed' || m === 'Aborted') return 'Ошибка сети: соединение оборвалось';
  return m;
}

/** Проверка «идём или ждём паузу/отмены» между чанками. */
export type PauseGate = () => Promise<void>;

/** Куда сообщить о принятых байтах (прогресс, скорость, ETA). */
export type ByteReporter = (n: number) => void;

function partPath(item: DownloadItem): string {
  return item.dest + '.part';
}

function partPathN(item: DownloadItem, i: number): string {
  return `${item.dest}.part.${i}`;
}

function cleanupParts(item: DownloadItem, threads: number) {
  fsp.rm(partPath(item), { force: true }).catch(() => {});
  for (let i = 0; i < Math.max(threads, 2); i++) fsp.rm(partPathN(item, i), { force: true }).catch(() => {});
}

function drain(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.removeListener('error', onErr);
      resolve();
    };
    const onErr = (e: Error) => {
      stream.removeListener('drain', onDrain);
      reject(e);
    };
    stream.once('drain', onDrain);
    stream.once('error', onErr);
  });
}

function existingSize(file: string): Promise<number> {
  return fsp.stat(file).then((s) => s.size).catch(() => 0);
}

/**
 * Одноточечная загрузка в dest.part с докачкой по Range.
 * После возврата dest.part проверен по размеру и хэшу (verifyFile).
 */
async function downloadSingle(
  item: DownloadItem,
  signal: AbortSignal,
  gate: PauseGate,
  report: ByteReporter
): Promise<void> {
  const part = partPath(item);
  let start = await existingSize(part);
  const headers: Record<string, string> = {};
  if (start > 0) headers.Range = `bytes=${start}-`;

  const req = await openRequest(item.url, headers, signal);
  const { res, bump, cleanup } = req;
  try {
    if (res.status === 429) throw new Throttle(retryAfterMs(res));
    if (res.status === 416) {
      // .part, похоже, уже полный — проверим его; не полный — начинаем заново.
      const st = await fsp.stat(part).catch(() => null);
      if (st && (!item.size || st.size >= item.size)) {
        await verifyFile(part, item); // либо ок, либо VerifyError → повтор
        return;
      }
      await fsp.rm(part, { force: true });
      throw new VerifyError('Сервер отказался продолжить (416), начинаем загрузку заново');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке ${item.url}`);
    if (start > 0 && res.status !== 206) {
      // сервер проигнорировал Range — начинаем с нуля
      await fsp.rm(part, { force: true });
      start = 0;
    }
    if (signal.aborted) throw new CancelledError();

    const out = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.on('finish', resolve);
      const reader = res.body?.getReader();
      if (!reader) return out.end();
      (async () => {
        for (;;) {
          await gate();
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          bump();
          const buf = Buffer.from(value);
          await pacer.take(buf.length);
          if (!out.write(buf)) await drain(out);
          report(buf.length);
        }
        out.end();
      })().catch((e) => {
        // Не ломаем стрим, а дописываем буфер: принятые байты останутся в .part
        // и докачка по Range начнётся ровно с того места, где оборвалось.
        try {
          out.end();
        } catch {
          out.destroy();
        }
        reject(e);
      });
    });
    await verifyFile(part, item);
  } finally {
    cleanup();
    try {
      await res.body?.cancel().catch(() => {});
    } catch {
      /* уже закрыто */
    }
  }
}

/* ----------------------- Range-загрузка крупного файла ----------------------- */

/**
 * Проверить, поддерживает ли сервер Range, и узнать полный размер.
 * ok=false — сервер отдаёт только цельный файл, качаем одним потоком.
 */
async function probeRanges(url: string, signal: AbortSignal): Promise<{ ok: boolean; total?: number }> {
  const req = await openRequest(url, { Range: 'bytes=0-0' }, signal);
  const { res, cleanup } = req;
  try {
    if (res.status === 429) throw new Throttle(retryAfterMs(res));
    if (res.status === 206) {
      const cr = res.headers.get('content-range') ?? '';
      const m = cr.match(/\/(\d+)\s*$/);
      return { ok: true, total: m ? Number(m[1]) : undefined };
    }
    if (res.status === 200) {
      const len = Number(res.headers.get('content-length') ?? 0);
      return { ok: false, total: len > 0 ? len : undefined };
    }
    throw new Error(`HTTP ${res.status} при проверке Range для ${url}`);
  } finally {
    cleanup();
    try {
      await res.body?.cancel().catch(() => {});
    } catch {
      /* ок */
    }
  }
}

interface Chunk {
  i: number;
  start: number;
  end: number; // инклюзивно
  len: number;
}

function planChunks(total: number, threads: number): Chunk[] {
  const n = Math.max(2, threads);
  const chunkLen = Math.ceil(total / n);
  const chunks: Chunk[] = [];
  for (let i = 0; ; i++) {
    const start = i * chunkLen;
    if (start >= total) break;
    const end = Math.min(total - 1, start + chunkLen - 1);
    chunks.push({ i, start, end, len: end - start + 1 });
  }
  return chunks;
}

async function downloadChunk(
  item: DownloadItem,
  c: Chunk,
  signal: AbortSignal,
  gate: PauseGate,
  report: ByteReporter
): Promise<void> {
  const file = partPathN(item, c.i);
  let offset = await existingSize(file);
  if (offset >= c.len) return; // этот сегмент уже готов (докатили в прошлом прогоне)
  if (offset > c.len) {
    await fsp.rm(file, { force: true });
    offset = 0;
  }
  const headers: Record<string, string> = { Range: `bytes=${c.start + offset}-${c.end}` };
  const req = await openRequest(item.url, headers, signal);
  const { res, bump, cleanup } = req;
  try {
    if (res.status === 429) throw new Throttle(retryAfterMs(res));
    if (res.status === 416) throw new VerifyError('Сегмент уже полностью получен, перепроверяем');
    if (res.status !== 206) throw new Error(`Сервер не отдал Range-сегмент (HTTP ${res.status})`);
    if (signal.aborted) throw new CancelledError();

    const out = fs.createWriteStream(file, { flags: offset > 0 ? 'a' : 'w' });
    let got = 0;
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.on('finish', resolve);
      const reader = res.body?.getReader();
      if (!reader) return out.end();
      (async () => {
        for (;;) {
          await gate();
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          bump();
          const room = c.len - (offset + got);
          if (room <= 0) break;
          const buf = Buffer.from(value).subarray(0, Math.min(room, value.byteLength));
          await pacer.take(buf.length);
          if (buf.length > 0 && !out.write(buf)) await drain(out);
          got += buf.length;
          report(buf.length);
        }
        out.end();
      })().catch((e) => {
        // Дописываем буфер: принятые байты сегмента останутся в .part.N для докачки.
        try {
          out.end();
        } catch {
          out.destroy();
        }
        reject(e);
      });
    });
  } finally {
    cleanup();
    try {
      await res.body?.cancel().catch(() => {});
    } catch {
      /* уже закрыто */
    }
  }
}

/**
 * Загрузить файл N параллельными Range-потоками в dest.part.N и собрать
 * в dest.part. Готовые сегменты докачивает (по размеру .part.N).
 * После возврата dest.part проверен по размеру и хэшу.
 */
async function downloadMulti(
  item: DownloadItem,
  total: number,
  signal: AbortSignal,
  gate: PauseGate,
  report: ByteReporter
): Promise<void> {
  const chunks = planChunks(total, rangeThreadsFor(item));
  const attemptCtrl = new AbortController();
  const attemptSignal = signal ? AbortSignal.any([signal, attemptCtrl.signal]) : attemptCtrl.signal;
  let firstError: unknown = null;

  const jobs = chunks.map((c) =>
    downloadChunk(item, c, attemptSignal, gate, report).catch((e) => {
      if (firstError === null) {
        firstError = e;
        if (!signal?.aborted) attemptCtrl.abort(e instanceof Error ? e : new Error('Один из потоков упал'));
      }
      throw e;
    })
  );
  await Promise.allSettled(jobs);
  if (firstError !== null) throw firstError;

  // Сборка: один проход, считаем хэши на лету.
  const out = partPath(item);
  const slots = makeHashers(item);
  const fh = await fsp.open(out, 'w');
  let written = 0;
  try {
    for (const c of chunks) {
      const file = partPathN(item, c.i);
      const st = await fsp.stat(file);
      if (st.size !== c.len) {
        throw new VerifyError(`Сегмент ${c.i + 1} из ${chunks.length} имеет неправильный размер (${st.size} из ${c.len})`);
      }
      const rs = fs.createReadStream(file);
      for await (const chunk of rs) {
        const buf = chunk as Buffer;
        for (const s of slots) s.h.update(buf);
        await fh.write(buf);
        written += buf.length;
      }
    }
  } finally {
    await fh.close().catch(() => {});
  }
  if (slots.length === 0 && item.size && written !== item.size) {
    throw new VerifyError(`Размер не совпал: ожидалось ${item.size} байт, собрано ${written}`);
  }
  const bad = slots.find((s) => s.h.digest('hex') !== s.expected);
  if (bad) throw new VerifyError(`Хэш ${bad.name} не совпал: файл ${path.basename(item.dest)} повреждён`);
}

/* ---------------------------- Ядро: попытка ---------------------------- */

type TaskLookup = () => DownloadTask | undefined;

function makeGate(lookup: TaskLookup, signal: AbortSignal): PauseGate {
  return async () => {
    for (;;) {
      if (signal.aborted) throw new CancelledError();
      const t = lookup();
      if (!t || t.status !== 'paused') return;
      await sleep(40);
    }
  };
}

/**
 * Запасной адрес файла у того же официального источника. CDN CurseForge
 * edge.forgecdn.net временами отдаёт 404 на существующие файлы, а
 * mediafilez.forgecdn.net с тем же путём — отдаёт (и наоборот).
 */
export function curseForgeAltUrl(url: string): string | null {
  if (url.startsWith('https://edge.forgecdn.net/')) return url.replace('https://edge.forgecdn.net/', 'https://mediafilez.forgecdn.net/');
  if (url.startsWith('https://mediafilez.forgecdn.net/')) return url.replace('https://mediafilez.forgecdn.net/', 'https://edge.forgecdn.net/');
  return null;
}

function withMirror(item: DownloadItem): DownloadItem {
  const alt = curseForgeAltUrl(item.url);
  return alt ? { ...item, url: alt } : item;
}

/**
 * Полная загрузка одного файла: пропуск по кэшу, retry с экспоненциальной паузой,
 * проверка размера и хэшей до атомарного rename.
 */
async function doDownload(
  item: DownloadItem,
  signal: AbortSignal,
  lookup: TaskLookup,
  cancelled: () => boolean,
  report: ByteReporter
): Promise<void> {
  // Файл уже на месте (кэш): размер + хэш совпадают — ничего не качаем.
  if (await fileOkFull(item.dest, item)) return;
  await fsp.mkdir(path.dirname(item.dest), { recursive: true });

  // Решаем стратегию: Range-потоки только для крупных файлов и если сервер умеет.
  let threads = 0;
  let total: number | undefined = item.size;
  if (rangeThreadsFor(item) > 0 && (item.size ?? 0) >= LARGE_FILE_MIN) {
    try {
      const probe = await probeRanges(item.url, signal);
      if (probe.ok) {
        threads = rangeThreadsFor(item);
        total = probe.total ?? item.size;
      }
    } catch (e) {
      if (e instanceof CancelledError || signal.aborted) throw new CancelledError();
      // 429/сеть на пробном запросе — упрёмся в retry-цикл ниже
      if (e instanceof Throttle) await sleep(e.waitMs, signal);
    }
  }
  if (threads > 0 && (!total || total <= 0)) threads = 0;

  const gate = makeGate(lookup, signal);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new CancelledError();
    const t = lookup();
    if (t) t.bytesDone = 0; // при повторе считаем прогресс заново
    // Повтор идёт и с запасного адреса того же источника (CurseForge: edge ↔ mediafilez)
    const src = attempt % 2 === 1 ? withMirror(item) : item;
    try {
      if (threads > 0) await downloadMulti(src, total as number, signal, gate, report);
      else await downloadSingle(src, signal, gate, report);
      await fsp.rename(partPath(item), item.dest); // атомарное перенесение
      if (threads > 0) cleanupParts(item, threads);
      return;
    } catch (e) {
      if (signal.aborted || cancelled()) throw new CancelledError();
      lastError = e;
      if (e instanceof VerifyError) {
        // битый файл не оставляем — удаляем .part* и качаем заново
        cleanupParts(item, threads);
      }
      const wait =
        e instanceof Throttle ? e.waitMs : Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
      await sleep(wait, signal);
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Не удалось скачать ${path.basename(item.dest)}: ${msg}`);
}

/* ------------------------------ Менеджер ------------------------------ */

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface QueueEntry {
  item: DownloadItem;
  taskId: string;
  rank: number; // 0 = high, 1 = normal, 2 = low
  seq: number;
  batchId: number;
  batchLimit: number;
  externalSignal?: AbortSignal;
  d: Deferred;
}

const PRIORITY_RANK: Record<'high' | 'normal' | 'low', number> = { high: 0, normal: 1, low: 2 };

const tasks = new Map<string, DownloadTask>();
const queue: QueueEntry[] = [];
const running = new Map<string, { batchId: number; ac: AbortController }>();
const userCancelled = new Set<string>();
let seqCounter = 0;
let batchCounter = 0;
let lastBroadcast = 0;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
/** Пакет загрузки (downloadMany) для каждой задачи-файла: в интерфейсе пакет — одна строка. */
const taskBatch = new Map<string, number>();
const batchSize = new Map<number, number>();
/**
 * Байты пакета целиком: размер всех файлов и уже скачанное. Готовые файлы
 * через несколько секунд пропадают из списка задач — без этого процент
 * пакета считался бы только по оставшимся файлам и «прыгал».
 */
const batchBytes = new Map<number, { total: number; known: boolean; finished: number }>();

function enqueue(
  item: DownloadItem,
  batchLimit: number,
  externalSignal: AbortSignal | undefined,
  batchId: number
): Deferred {
  const id = crypto.randomUUID();
  const priority = item.priority ?? 'normal';
  const task: DownloadTask = {
    id,
    title: item.title ?? path.basename(item.dest),
    detail: item.url,
    total: item.size ?? 0,
    done: 0,
    bytesDone: 0,
    bytesTotal: item.size ?? 0,
    status: 'queued',
    priority,
    group: item.group,
    canCancel: true,
  };
  tasks.set(id, task);
  taskBatch.set(id, batchId);
  const d = deferred();
  queue.push({
    item,
    taskId: id,
    rank: PRIORITY_RANK[priority],
    seq: seqCounter++,
    batchId,
    batchLimit,
    externalSignal,
    d,
  });
  queue.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  emit(true);
  // Отложенный запуск: синхронная партия вызовов (downloadMany, несколько
  // downloadFile в одном тике) успевает целиком встать в очередь и отсортироваться
  // по приоритетам, прежде чем что-то стартует.
  queueMicrotask(() => schedule());
  return d;
}

function batchRunningCounts(): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of running.values()) m.set(r.batchId, (m.get(r.batchId) ?? 0) + 1);
  return m;
}

function schedule() {
  for (;;) {
    if (running.size >= config.maxConcurrent) return;
    const counts = batchRunningCounts();
    const idx = queue.findIndex((q) => {
      const t = tasks.get(q.taskId);
      if (!t || t.status === 'paused' || t.status === 'cancelled') return false;
      return (counts.get(q.batchId) ?? 0) < q.batchLimit;
    });
    if (idx === -1) return;
    const [q] = queue.splice(idx, 1);
    startRun(q);
  }
}

function startRun(q: QueueEntry) {
  const task = tasks.get(q.taskId);
  if (!task || task.status === 'paused' || task.status === 'cancelled') {
    // Задачу поставили на паузу/отменили между проверкой и запуском — вернём в очередь.
    if (task && task.status === 'paused') queue.push(q);
    return;
  }
  const ac = new AbortController();
  running.set(q.taskId, { batchId: q.batchId, ac });
  task.status = 'running';
  const signal = q.externalSignal
    ? AbortSignal.any([q.externalSignal, ac.signal])
    : ac.signal;
  emit(true);
  doDownload(
    q.item,
    signal,
    () => tasks.get(q.taskId),
    () => userCancelled.has(q.taskId),
    (n) => noteBytes(q.taskId, n)
  )
    .then(() => settle(q, null))
    .catch((e) => settle(q, e));
}

function settle(q: QueueEntry, error: unknown) {
  running.delete(q.taskId);
  userCancelled.delete(q.taskId);
  const task = tasks.get(q.taskId);
  if (task && task.status !== 'cancelled') {
    if (error) {
      task.status = 'error';
      task.error = error instanceof Error ? error.message : String(error);
      task.canCancel = false;
      task.speedBps = 0;
    } else {
      task.status = 'done';
      task.done = task.bytesTotal ?? task.total ?? task.done;
      task.bytesDone = task.bytesTotal ?? task.bytesDone;
      const bb = batchBytes.get(q.batchId);
      if (bb) bb.finished += task.bytesTotal || q.item.size || task.bytesDone || 0;
      task.canCancel = false;
      task.speedBps = 0;
    }
  }
  if (error) q.d.reject(error);
  else q.d.resolve();
  emit(true);
  schedule();
  // Отменённую загрузку не докатываем: убираем .part, когда стримы точно закрылись.
  if (tasks.get(q.taskId)?.status === 'cancelled') {
    setTimeout(() => cleanupParts(q.item, rangeThreadsFor(q.item)), 150);
  }
  // Держим завершённую задачу в списке недолго — как раньше.
  setTimeout(() => {
    const t = tasks.get(q.taskId);
    if (t && (t.status === 'done' || t.status === 'error' || t.status === 'cancelled')) {
      tasks.delete(q.taskId);
      taskBatch.delete(q.taskId);
      emit(true);
    }
  }, 6000);
}

/* --------------------------- Публичное API --------------------------- */

/**
 * Скачать один файл. Проходит через общий менеджер (приоритеты, лимиты,
 * пауза/отмена по задаче). Сигнал извне отменяет задачу целиком.
 */
export async function downloadFile(item: DownloadItem, signal?: AbortSignal): Promise<void> {
  const d = enqueue(item, Number.MAX_SAFE_INTEGER, signal, batchCounter++);
  await d.promise;
}

/**
 * Скачать несколько файлов. concurrency — предел одновременно идущих файлов
 * внутри этой партии (сверх того сработает общий maxConcurrent менеджера).
 */
export async function downloadMany(
  items: DownloadItem[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const batchLimit = opts.concurrency ?? 6;
  const batchId = batchCounter++;
  batchSize.set(batchId, items.length);
  batchBytes.set(batchId, {
    total: items.reduce((n, i) => n + (i.size ?? 0), 0),
    known: items.every((i) => (i.size ?? 0) > 0),
    finished: 0
  });
  let done = 0;
  const deferreds = items.map((item) => enqueue(item, batchLimit, opts.signal, batchId));
  await Promise.all(
    deferreds.map((d) =>
      d.promise.then(
        () => {
          done++;
          opts.onProgress?.(done, items.length);
        },
        (e) => {
          done++;
          opts.onProgress?.(done, items.length);
          throw e;
        }
      )
    )
  ).finally(() => {
    // Строка пакета исчезнет вместе с последней задачей-файлом
    setTimeout(() => {
      batchSize.delete(batchId);
      batchBytes.delete(batchId);
    }, 7000);
  });
}

/* ------------------------------ Задачи для интерфейса ------------------------------ */

const speedState = new Map<string, { t: number; b: number; speed: number }>();

/** Принять N байтов по задаче: прогресс, скорость (Б/с), ETA. */
function noteBytes(taskId: string, n: number) {
  const t = tasks.get(taskId);
  if (!t || n <= 0) return;
  t.bytesDone = (t.bytesDone ?? 0) + n;
  if (t.bytesTotal) t.bytesDone = Math.min(t.bytesDone, t.bytesTotal);
  const now = Date.now();
  const s = speedState.get(taskId) ?? { t: now, b: t.bytesDone ?? 0, speed: 0 };
  const dt = (now - s.t) / 1000;
  if (dt < 0.25) return; // обновляем скорость не чаще 4 раз в секунду
  const inst = (t.bytesDone - s.b) / dt;
  s.speed = s.speed <= 0 ? inst : 0.6 * s.speed + 0.4 * inst;
  s.t = now;
  s.b = t.bytesDone;
  speedState.set(taskId, s);
  t.speedBps = Math.max(0, Math.round(s.speed));
  const remaining = (t.bytesTotal ?? 0) - (t.bytesDone ?? 0);
  t.etaSeconds = t.speedBps > 0 && remaining > 0 ? Math.max(1, Math.ceil(remaining / t.speedBps)) : undefined;
  emit();
}

export function getTasks(): DownloadTask[] {
  const out: DownloadTask[] = [];
  const batches = new Map<number, DownloadTask[]>();
  for (const t of tasks.values()) {
    const b = taskBatch.get(t.id);
    if (b !== undefined && (batchSize.get(b) ?? 1) > 1) {
      const list = batches.get(b) ?? [];
      list.push(t);
      batches.set(b, list);
    } else out.push(t);
  }
  for (const [b, list] of batches) out.push(batchTask(b, list));
  return out;
}

const ACTIVE: DownloadTask['status'][] = ['running', 'queued', 'paused'];

/** Сводная задача пакета: файлов N из M, байты и скорость — суммой. */
function batchTask(b: number, list: DownloadTask[]): DownloadTask {
  const size = batchSize.get(b) ?? list.length;
  const finished = size - list.filter((t) => ACTIVE.includes(t.status)).length;
  const status: DownloadTask['status'] = list.some((t) => t.status === 'running')
    ? 'running'
    : list.some((t) => t.status === 'queued')
      ? 'queued'
      : list.some((t) => t.status === 'paused')
        ? 'paused'
        : list.some((t) => t.status === 'error')
          ? 'error'
          : 'done';
  const sum = (k: 'bytesDone' | 'bytesTotal' | 'speedBps') => list.reduce((n, t) => n + (t[k] ?? 0), 0);
  const bb = batchBytes.get(b);
  const activeBytes = list.filter((t) => ACTIVE.includes(t.status)).reduce((n, t) => n + (t.bytesDone ?? 0), 0);
  // Размер всех файлов известен — процент по байтам всего пакета, иначе — по числу файлов
  const bytesTotal = bb?.known ? bb.total : 0;
  const bytesDone = bb?.known ? Math.min(bb.total, bb.finished + activeBytes) : 0;
  return {
    id: `batch:${b}`,
    title: `Файлов: ${size}`,
    detail: list.find((t) => t.status === 'running')?.title,
    total: size,
    done: Math.max(0, finished),
    status,
    error: list.find((t) => t.error)?.error,
    bytesDone: bb ? bytesDone : sum('bytesDone'),
    bytesTotal: bb ? bytesTotal : sum('bytesTotal'),
    speedBps: sum('speedBps'),
    canCancel: status !== 'done'
  };
}

/** id задач пакета (для паузы/отмены строки «batch:N»). */
function batchMembers(id: string): string[] | null {
  if (!id.startsWith('batch:')) return null;
  const b = Number(id.slice(6));
  return [...taskBatch.entries()].filter(([, v]) => v === b).map(([k]) => k);
}

/**
 * Сводка по всем активным загрузкам: общие байты, скорость и ETA.
 * Для задач без known-размера bytesTotal учитывает только известные.
 */
export function getDownloadStats(): DownloadStats {
  let bytesDone = 0;
  let bytesTotal = 0;
  let speed = 0;
  let knownEta = false;
  let eta = 0;
  for (const t of tasks.values()) {
    if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'queued') continue;
    bytesDone += t.bytesDone ?? 0;
    bytesTotal += t.bytesTotal ?? 0;
    speed += t.speedBps ?? 0;
    if (t.etaSeconds !== undefined) {
      eta = Math.max(eta, t.etaSeconds);
      knownEta = true;
    }
  }
  return {
    bytesDone,
    bytesTotal,
    speedBps: speed,
    etaSeconds: knownEta ? eta : null,
    running: running.size,
    queued: queue.length,
  };
}

export function createTask(title: string, detail?: string): string {
  const id = crypto.randomUUID();
  tasks.set(id, { id, title, detail, total: 0, done: 0, status: 'queued' });
  emit(true);
  return id;
}

export function isTaskCancelled(id: string): boolean {
  return tasks.get(id)?.status === 'cancelled';
}

export function updateTask(id: string, patch: Partial<DownloadTask>) {
  const task = tasks.get(id);
  if (!task) return;
  Object.assign(task, patch);
  emit();
}

export function finishTask(id: string, error?: string) {
  const task = tasks.get(id);
  if (!task) return;
  task.status = error ? 'error' : 'done';
  task.error = error;
  if (!error) task.done = task.total || task.done;
  speedState.delete(id);
  emit(true);
  setTimeout(() => {
    tasks.delete(id);
    taskBatch.delete(id);
    emit(true);
  }, 6000);
}

/** Поставить задачу на паузу (в очереди или на лету). */
export function pauseTask(id: string): boolean {
  const members = batchMembers(id);
  if (members) return members.map((m) => pauseTask(m)).some(Boolean);
  const inQueue = queue.some((q) => q.taskId === id);
  const inRun = running.has(id);
  const task = tasks.get(id);
  if (!task || (!inQueue && !inRun)) return false;
  if (task.status === 'queued' || task.status === 'running') task.status = 'paused';
  task.canCancel = true;
  emit(true);
  return true;
}

/** Возобновить задачу с паузы. */
export function resumeTask(id: string): boolean {
  const members = batchMembers(id);
  if (members) return members.map((m) => resumeTask(m)).some(Boolean);
  const task = tasks.get(id);
  if (!task || task.status !== 'paused') return false;
  task.status = 'queued';
  emit(true);
  schedule();
  return true;
}

/** Отменить задачу: в очереди — просто убрать, на лету — оборвать запросы и убрать .part. */
export function cancelTask(id: string): boolean {
  const members = batchMembers(id);
  if (members) return members.map((m) => cancelTask(m)).some(Boolean);
  const qIdx = queue.findIndex((q) => q.taskId === id);
  const run = running.get(id);
  if (qIdx === -1 && !run) {
    // Своя задача (без файлов в очереди): её владелец сам проверяет isTaskCancelled
    const own = tasks.get(id);
    if (!own || !own.canCancel || (own.status !== 'running' && own.status !== 'queued')) return false;
    own.status = 'cancelled';
    own.canCancel = false;
    emit(true);
    return true;
  }
  userCancelled.add(id);
  const task = tasks.get(id);
  if (task) {
    task.status = 'cancelled';
    task.canCancel = false;
    task.speedBps = 0;
  }
  speedState.delete(id);
  if (qIdx !== -1) {
    const [q] = queue.splice(qIdx, 1);
    q.d.reject(new CancelledError());
    cleanupParts(q.item, rangeThreadsFor(q.item));
  }
  if (run) run.ac.abort(new CancelledError());
  emit(true);
  schedule();
  return true;
}

function emit(force = false) {
  if (emitTimer) return;
  const wait = force ? 40 : Math.max(0, EMIT_THROTTLE_MS - (Date.now() - lastBroadcast));
  emitTimer = setTimeout(() => {
    emitTimer = null;
    lastBroadcast = Date.now();
    broadcast('downloads:changed', getTasks());
  }, wait);
}
