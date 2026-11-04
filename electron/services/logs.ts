import fs from 'node:fs';
import path from 'node:path';
import { instanceDir } from './paths';
import { emit } from './events';
import type { LogLine } from '../../shared/types';

const MAX_LINES = 5000;
const buffers = new Map<string, LogLine[]>();

export function getLogs(instanceId: string): LogLine[] {
  return buffers.get(instanceId) ?? [];
}

export function clearLogs(instanceId: string) {
  buffers.set(instanceId, []);
  emit('game:log-cleared', instanceId);
}

export function appendLog(instanceId: string, text: string, stream: LogLine['stream'] = 'out') {
  const line: LogLine = { ts: Date.now(), line: text, stream };
  const list = buffers.get(instanceId) ?? [];
  list.push(line);
  if (list.length > MAX_LINES) list.splice(0, list.length - MAX_LINES);
  buffers.set(instanceId, list);
  queueEmit(instanceId, line);
  if (stream !== 'launcher') writeToDisk(instanceId, text);
}

/**
 * Строки лога уходят в окно пачками раз в 100 мс: модпак на сотни модов пишет
 * тысячи строк в секунду, и по событию на строку интерфейс захлёбывался.
 */
const pending = new Map<string, LogLine[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function queueEmit(instanceId: string, line: LogLine) {
  const list = pending.get(instanceId) ?? [];
  list.push(line);
  pending.set(instanceId, list);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      for (const [id, lines] of pending) emit('game:logs', { instanceId: id, lines: lines.slice(-MAX_LINES) });
      pending.clear();
    }, 100);
  }
}

/**
 * Запись на диск — пачками раз в 250 мс. Раньше каждая строка открывала и
 * дописывала два файла синхронно: модпак на сотни модов пишет тысячи строк
 * в секунду, и главный процесс лаунчера был занят только этим.
 */
const DISK_FLUSH_MS = 250;
const diskPending = new Map<string, string[]>();
const knownDirs = new Set<string>();
let diskTimer: ReturnType<typeof setTimeout> | null = null;

function writeToDisk(instanceId: string, text: string) {
  const list = diskPending.get(instanceId) ?? [];
  list.push(text);
  diskPending.set(instanceId, list);
  diskTimer ??= setTimeout(() => {
    diskTimer = null;
    flushLogFiles();
  }, DISK_FLUSH_MS);
}

/** Дописать накопленные строки в файлы логов сейчас (выход из игры, новый сеанс, закрытие лаунчера). */
export function flushLogFiles(instanceId?: string) {
  for (const [id, lines] of diskPending) {
    if (instanceId && id !== instanceId) continue;
    diskPending.delete(id);
    if (!lines.length) continue;
    const dir = path.join(instanceDir(id), 'logs');
    const chunk = lines.join('\n') + '\n';
    const write = () => {
      if (!knownDirs.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        knownDirs.add(dir);
      }
      const stamp = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(path.join(dir, `ploxel-${stamp}.log`), chunk, 'utf8');
      fs.appendFileSync(path.join(dir, 'ploxel-latest.log'), chunk, 'utf8');
    };
    try {
      write();
    } catch {
      // Папку могли удалить (вместе со сборкой) — создаём заново и пробуем ещё раз
      knownDirs.delete(dir);
      try {
        write();
      } catch {
        /* диск недоступен — не мешаем игре */
      }
    }
  }
}

export function startNewSessionLog(instanceId: string) {
  // Хвост прошлого сеанса — в файлы до того, как ploxel-latest.log очистится
  flushLogFiles(instanceId);
  try {
    const dir = path.join(instanceDir(instanceId), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ploxel-latest.log'), '', 'utf8');
  } catch {
    /* игнорируем */
  }
  clearLogs(instanceId);
}

/** Простая эвристика: важная строка для подсветки в консоли. */
export function classifyLine(line: string): 'error' | 'warn' | 'info' | 'debug' {
  if (/\b(ERROR|FATAL|SEVERE)\b/.test(line) || /Exception|Error:/i.test(line)) return 'error';
  if (/\bWARN(ING)?\b/.test(line) || /WARNING/i.test(line)) return 'warn';
  if (/\bDEBUG\b/.test(line) || /TRACE/.test(line)) return 'debug';
  return 'info';
}

export function exportLog(instanceId: string, target: string): string {
  const lines = getLogs(instanceId).map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`);
  fs.writeFileSync(target, lines.join('\n'), 'utf8');
  return target;
}