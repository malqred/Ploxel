import zlib from 'node:zlib';

/**
 * Минимальный разбор NBT (Named Binary Tag) — формат level.dat в Minecraft.
 * Поддерживаются сжатие gzip и zlib; возвращаются только нужные поля,
 * но парсер читает весь файл корректно.
 */

export type NbtValue =
  | number
  | bigint
  | string
  | NbtValue[]
  | { [key: string]: NbtValue }
  | IntArray
  | LongArray;

export class IntArray extends Array<number> {}
export class LongArray extends Array<bigint> {}

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

class Reader {
  buf: Buffer;
  pos = 0;
  constructor(buf: Buffer) {
    this.buf = buf;
  }
  u8() {
    return this.buf.readUInt8(this.pos++);
  }
  i8() {
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }
  i16() {
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }
  f32() {
    const v = this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }
  str() {
    const len = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
}

function readPayload(r: Reader, type: number): NbtValue {
  switch (type) {
    case TAG_BYTE:
      return r.i8();
    case TAG_SHORT:
      return r.i16();
    case TAG_INT:
      return r.i32();
    case TAG_LONG:
      return r.i64();
    case TAG_FLOAT:
      return r.f32();
    case TAG_DOUBLE:
      return r.f64();
    case TAG_BYTE_ARRAY: {
      const len = r.i32();
      const arr = new IntArray();
      for (let i = 0; i < len; i++) arr.push(r.i8());
      return arr;
    }
    case TAG_STRING:
      return r.str();
    case TAG_LIST: {
      const itemType = r.u8();
      const len = r.i32();
      const arr: NbtValue[] = [];
      for (let i = 0; i < len; i++) arr.push(readPayload(r, itemType));
      return arr;
    }
    case TAG_COMPOUND: {
      const obj: { [key: string]: NbtValue } = {};
      for (;;) {
        const t = r.u8();
        if (t === TAG_END) break;
        const name = r.str();
        obj[name] = readPayload(r, t);
      }
      return obj;
    }
    case TAG_INT_ARRAY: {
      const len = r.i32();
      const arr = new IntArray();
      for (let i = 0; i < len; i++) arr.push(r.i32());
      return arr;
    }
    case TAG_LONG_ARRAY: {
      const len = r.i32();
      const arr = new LongArray();
      for (let i = 0; i < len; i++) arr.push(r.i64());
      return arr;
    }
    default:
      throw new Error(`Неизвестный тип NBT: ${type}`);
  }
}

export function parseNbt(raw: Buffer): { name: string; value: NbtValue } {
  const buf = decompress(raw);
  const r = new Reader(buf);
  const type = r.u8();
  const name = r.str();
  const value = readPayload(r, type);
  return { name, value };
}

function decompress(buf: Buffer): Buffer {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  // zlib-заголовок 0x78
  if (buf.length > 2 && buf[0] === 0x78) {
    try {
      return zlib.inflateSync(buf);
    } catch {
      return buf;
    }
  }
  return buf;
}

export function asCompound(value: NbtValue | undefined): Record<string, NbtValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, NbtValue>) : {};
}

export function asString(value: NbtValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: NbtValue | undefined, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}