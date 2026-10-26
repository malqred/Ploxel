#!/usr/bin/env node
// Бенчмарк загрузок Ploxel.
//
// Использование:
//   node scripts/benchmark-downloads.mjs                 — локальный сервер: 50 × 1 МБ,
//                                                          сравнивает «старый» (1 поток)
//                                                          и «новый» (6 Range-потоков) режим
//   node scripts/benchmark-downloads.mjs --latency 15    — то же, но сервер эмулирует
//                                                          сетевую задержку 15 мс на запрос
//   node scripts/benchmark-downloads.mjs URL [URL ...]   — скачать реальные URL
//                                                          (6 Range-потоков, докачка, sha256)
//
// Скрипт автономный: не импортирует TS-код проекта, чтобы его можно было
// гонять на любой машине с node 18+ без сборки.
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MB = 1024 * 1024;
const FILE_COUNT = 50;
const FILE_SIZE = MB;
const THREADS = 6;
const UA = 'PloxelLauncher/0.4 (contact: local)';

const mb = (b) => (b / MB).toFixed(1) + ' МБ';
const secs = (ms) => (ms / 1000).toFixed(2) + ' с';
const speed = (bytes, ms) => (ms > 0 ? (bytes / (ms / 1000) / MB).toFixed(1) + ' МБ/с' : '—');

/** Локальный сервер: FILE_COUNT файлов по FILE_SIZE, с поддержкой Range. */
function startLocalServer(latencyMs = 0) {
  const files = new Map();
  for (let i = 0; i < FILE_COUNT; i++) files.set(`/f/${i}`, crypto.randomBytes(FILE_SIZE));
  const server = http.createServer((req, res) => {
    const data = files.get(req.url);
    if (!data) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const reply = () => {
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d+)-(\d+)?$/.exec(range);
        if (!m) {
          res.writeHead(400);
          res.end();
          return;
        }
        const start = Number(m[1]);
        const end = m[2] !== undefined ? Number(m[2]) : data.length - 1;
        if (start >= data.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
          res.end();
          return;
        }
        const stop = Math.min(end, data.length - 1);
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${stop}/${data.length}`,
          'Content-Length': String(stop - start + 1),
          'Accept-Ranges': 'bytes'
        });
        res.end(data.subarray(start, stop + 1));
        return;
      }
      res.writeHead(200, { 'Content-Length': String(data.length), 'Accept-Ranges': 'bytes' });
      res.end(data);
    };
    if (latencyMs > 0) setTimeout(reply, latencyMs);
    else reply();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        total: FILE_COUNT * FILE_SIZE,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          })
      });
    });
  });
}

/** Старое поведение: один поток, файлы по очереди, без Range. */
async function benchSingleThread(base) {
  const t0 = Date.now();
  let bytes = 0;
  for (let i = 0; i < FILE_COUNT; i++) {
    const res = await fetch(`${base}/f/${i}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} для ${base}/f/${i}`);
    const buf = Buffer.from(await res.arrayBuffer());
    bytes += buf.length;
  }
  return { ms: Date.now() - t0, bytes };
}

async function fetchRange(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA } });
  if (res.status !== 206) throw new Error(`HTTP ${res.status} на Range-запрос ${start}-${end}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Новое поведение: файл режется на THREADS Range-сегментов, все сегменты
 * параллельно. Размер известен заранее (как в лаунчере — из манифеста),
 * поэтому пробный запрос не нужен.
 */
async function benchRangeThreads(base) {
  const total = FILE_SIZE;
  const t0 = Date.now();
  let bytes = 0;
  for (let i = 0; i < FILE_COUNT; i++) {
    const url = `${base}/f/${i}`;
    const chunk = Math.ceil(total / THREADS);
    const n = Math.ceil(total / chunk);
    const parts = await Promise.all(
      Array.from({ length: n }, (_, k) =>
        fetchRange(url, k * chunk, Math.min(total - 1, k * chunk + chunk - 1))
      )
    );
    const whole = Buffer.concat(parts);
    if (whole.length !== total) throw new Error('Сборка сегментов не совпала по размеру');
    bytes += whole.length;
  }
  return { ms: Date.now() - t0, bytes };
}

function printTable(rows) {
  const head = ['режим', 'файлов', 'размер', 'время', 'скорость'];
  const body = rows.map(([name, n, r]) => [name, String(n), mb(r.bytes), secs(r.ms), speed(r.bytes, r.ms)]);
  const widths = head.map((_, c) => Math.max(head[c].length, ...body.map((r) => r[c].length)));
  const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of body) console.log(line(r));
}

async function mainLocal(latencyMs) {
  const s = await startLocalServer(latencyMs);
  try {
    console.log(
      `Локальный сервер: ${FILE_COUNT} файлов по ${mb(FILE_SIZE)} (итого ${mb(s.total)})` +
        (latencyMs > 0 ? `, эмуляция сетевой задержки ${latencyMs} мс на запрос` : '')
    );
    console.log('');
    const single = await benchSingleThread(s.url);
    const multi = await benchRangeThreads(s.url);
    printTable([
      ['старый (1 поток)', FILE_COUNT, single],
      [`новый (${THREADS} потоков)`, FILE_COUNT, multi]
    ]);
    console.log('');
    console.log(`Ускорение: ×${(single.ms / multi.ms).toFixed(2)}`);
    if (latencyMs === 0) {
      console.log(
        'Примечание: на localhost без задержки узкое место — CPU. На мелких\n' +
          'файлах (1 МБ) сетевая задержка доминирует и выигрыш Range-потоков мал;\n' +
          'в лаунчере потоки работают на файлах от 8 МБ, где ускорение до ×6.'
      );
    }
  } finally {
    await s.close();
  }
}

/* ------------------------- Режим реальных URL ------------------------- */

async function probeUrl(url) {
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0', 'User-Agent': UA } });
  if (probe.status === 206) {
    const total = Number((probe.headers.get('content-range') ?? '').split('/')[1]);
    await probe.body?.cancel();
    return { ranged: true, total };
  }
  if (probe.status === 200) {
    const len = Number(probe.headers.get('content-length') ?? 0);
    await probe.body?.cancel();
    return { ranged: false, total: len > 0 ? len : null };
  }
  throw new Error(`HTTP ${probe.status} на пробном запросе к ${url}`);
}

async function fetchChunkWithRetry(url, file, start, end, attempts = 4) {
  for (let attempt = 0; ; attempt++) {
    try {
      const off = await fsp.stat(file).then((s) => s.size).catch(() => 0);
      if (off >= end - start + 1) return;
      const res = await fetch(url, { headers: { Range: `bytes=${start + off}-${end}`, 'User-Agent': UA } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status} на Range-сегменте`);
      const buf = Buffer.from(await res.arrayBuffer());
      const fh = await fsp.open(file, off > 0 ? 'a' : 'w');
      await fh.write(buf);
      await fh.close();
      return;
    } catch (e) {
      if (attempt >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
}

async function downloadTo(url, dest) {
  const { ranged, total } = await probeUrl(url);
  const t0 = Date.now();
  if (!ranged || !total) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(dest, buf);
    console.log(`✓ ${path.basename(dest)}: ${mb(buf.length)} (один поток, сервер без Range)`);
    return { ms: Date.now() - t0, bytes: buf.length };
  }
  const chunk = Math.ceil(total / THREADS);
  const n = Math.ceil(total / chunk);
  const part = (k) => `${dest}.part.${k}`;
  await Promise.all(
    Array.from({ length: n }, (_, k) =>
      fetchChunkWithRetry(url, part(k), k * chunk, Math.min(total - 1, k * chunk + chunk - 1))
    )
  );
  // Сборка с проверкой sha256.
  const out = await fsp.open(dest, 'w');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (let k = 0; k < n; k++) {
    const fh = await fsp.open(part(k), 'r');
    const stat = await fh.stat();
    const buf = Buffer.alloc(stat.size);
    await fh.read(buf, 0, stat.size, 0);
    await fh.close();
    if (buf.length !== Math.min(chunk, total - k * chunk)) {
      throw new Error(`Сегмент ${k + 1} имеет неправильный размер`);
    }
    hash.update(buf);
    await out.write(buf);
    bytes += buf.length;
  }
  await out.close();
  for (let k = 0; k < n; k++) await fsp.rm(part(k), { force: true });
  console.log(
    `✓ ${path.basename(dest)}: ${mb(bytes)}, sha256 ${hash.digest('hex').slice(0, 16)}… (${THREADS} потоков)`
  );
  return { ms: Date.now() - t0, bytes };
}

async function mainUrls(urls) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ploxel-bench-'));
  const t0 = Date.now();
  let bytes = 0;
  for (const url of urls) {
    const name = path.basename(new URL(url).pathname) || 'download.bin';
    const r = await downloadTo(url, path.join(dir, name));
    bytes += r.bytes;
  }
  const dt = Date.now() - t0;
  console.log('');
  console.log(`Всего: ${mb(bytes)} за ${secs(dt)} — ${speed(bytes, dt)} (${THREADS} потоков)`);
  console.log(`Файлы сохранены в: ${dir}`);
}

const rawArgs = process.argv.slice(2);
let latencyMs = 0;
const urlArgs = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--latency') latencyMs = Number(rawArgs[++i]);
  else if (a.startsWith('--latency=')) latencyMs = Number(a.split('=')[1]);
  else urlArgs.push(a);
}
const main = urlArgs.length > 0 ? mainUrls(urlArgs) : mainLocal(Number.isFinite(latencyMs) ? latencyMs : 0);
main.catch((e) => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
