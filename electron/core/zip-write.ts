// Потоковая запись zip: файлы сжимаются по одному и сразу пишутся на диск.
// AdmZip держит в памяти весь архив — мир на пару гигабайт ронял бы лаунчер.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const LIMIT = 0xffffffff;

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, r)));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

/**
 * Упаковывает папку в zip. prefix — папка внутри архива (например, имя мира),
 * чтобы при распаковке сохранилось название.
 */
export async function zipDirectory(dir: string, target: string, prefix = ''): Promise<{ files: number; bytes: number }> {
  const files = await listFiles(dir);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.part`;
  const fd = await fsp.open(tmp, 'w');
  const central: Buffer[] = [];
  let offset = 0;
  try {
    for (const rel of files) {
      const abs = path.join(dir, rel);
      const data = await fsp.readFile(abs);
      const st = await fsp.stat(abs);
      const name = Buffer.from((prefix ? `${prefix}/` : '') + rel, 'utf8');
      const deflated = zlib.deflateRawSync(data, { level: 6 });
      // Уже сжатое (регионы мира, png) иногда не ужимается — тогда храним как есть
      const store = deflated.length >= data.length;
      const body = store ? data : deflated;
      if (data.length > LIMIT || offset + body.length > LIMIT) {
        throw new Error('Мир больше 4 ГБ — такой архив без ZIP64 не собрать. Скопируйте папку мира вручную.');
      }
      const crc = zlib.crc32(data);
      const { time, date } = dosDateTime(st.mtime);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // имена в UTF-8
      local.writeUInt16LE(store ? 0 : 8, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await fd.write(local);
      await fd.write(name);
      await fd.write(body);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(store ? 0 : 8, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(body.length, 20);
      cd.writeUInt32LE(data.length, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, name);
      offset += 30 + name.length + body.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Math.min(files.length, 0xffff), 8);
    eocd.writeUInt16LE(Math.min(files.length, 0xffff), 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    await fd.write(cdBuf);
    await fd.write(eocd);
    await fd.close();
    await fsp.rm(target, { force: true });
    await fsp.rename(tmp, target);
    return { files: files.length, bytes: offset };
  } catch (e) {
    await fd.close().catch(() => undefined);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
