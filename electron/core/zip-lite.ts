// Лёгкое чтение zip/jar: оглавление (central directory) и отдельные записи
// без загрузки всего архива в память. AdmZip читает файл целиком — для проверки
// сборки из 240 модов это ~800 МБ на каждый проход, и главный процесс подвисал.

import fs from 'node:fs';
import zlib from 'node:zlib';

export interface LiteEntry {
  /** имя записи как в архиве */
  name: string;
  isDirectory: boolean;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface LiteZip {
  entries: LiteEntry[];
  read(entry: LiteEntry): Buffer;
  close(): void;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRY = 1024 * 1024 * 1024;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buf, done, length - done, position + done);
    if (n <= 0) break;
    done += n;
  }
  return done === length ? buf : buf.subarray(0, done);
}

/** Открывает архив и читает оглавление. Бросает ошибку, если это не zip. */
export function openZipLite(file: string): LiteZip {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    // Конец архива: запись EOCD (22 байта) + комментарий до 64 КБ
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Не zip-архив: нет оглавления');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    // ZIP64: настоящие значения — в отдельной записи
    if ((cdOffset === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
      const z64Offset = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const z64 = readAt(fd, z64Offset, 56);
      if (z64.readUInt32LE(0) === ZIP64_EOCD) {
        count = Number(z64.readBigUInt64LE(32));
        cdSize = Number(z64.readBigUInt64LE(40));
        cdOffset = Number(z64.readBigUInt64LE(48));
      }
    }
    if (cdOffset + cdSize > size) throw new Error('Повреждённое оглавление архива');
    const cd = readAt(fd, cdOffset, cdSize);
    const entries: LiteEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CENTRAL) break;
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // ZIP64 extra (id 0x0001): 64-битные размеры и смещение — в порядке тех полей, что равны 0xffffffff
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressed === 0xffffffff && q + 8 <= e + 4 + len) (uncompressed = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (compressedSize === 0xffffffff && q + 8 <= e + 4 + len) (compressedSize = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (localOffset === 0xffffffff && q + 8 <= e + 4 + len) localOffset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      entries.push({ name, isDirectory: name.endsWith('/'), method, compressedSize, size: uncompressed, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    let closed = false;
    return {
      entries,
      read(entry: LiteEntry): Buffer {
        if (closed) throw new Error('Архив закрыт');
        if (entry.size > MAX_ENTRY || entry.compressedSize > MAX_ENTRY) throw new Error('Слишком большая запись');
        const head = readAt(fd, entry.localOffset, 30);
        if (head.length < 30 || head.readUInt32LE(0) !== LOCAL) throw new Error('Повреждённая запись архива');
        const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        const data = readAt(fd, start, entry.compressedSize);
        if (entry.method === 0) return data;
        if (entry.method === 8) return zlib.inflateRawSync(data);
        throw new Error(`Неподдерживаемое сжатие: ${entry.method}`);
      },
      close() {
        if (!closed) {
          closed = true;
          fs.closeSync(fd);
        }
      }
    };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}
