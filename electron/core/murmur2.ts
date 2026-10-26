// Отпечаток файла CurseForge: MurmurHash2 (32 бита, seed 1) по байтам файла
// без пробельных символов (9, 10, 13, 32). По нему CurseForge находит файл
// мода в каталоге — так же, как Modrinth по SHA1.

const M = 0x5bd1e995;

export function murmur2(data: Uint8Array, seed: number): number {
  let len = data.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;
  while (len >= 4) {
    let k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    k = Math.imul(k, M);
    k ^= k >>> 24;
    k = Math.imul(k, M);
    h = Math.imul(h, M) ^ k;
    i += 4;
    len -= 4;
  }
  // Хвост из 1–3 байт
  if (len >= 3) h ^= data[i + 2] << 16;
  if (len >= 2) h ^= data[i + 1] << 8;
  if (len >= 1) {
    h ^= data[i];
    h = Math.imul(h, M);
  }
  h ^= h >>> 13;
  h = Math.imul(h, M);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Убирает пробельные байты так же, как это делает CurseForge. */
export function stripWhitespace(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let n = 0;
  for (const b of data) {
    if (b === 9 || b === 10 || b === 13 || b === 32) continue;
    out[n++] = b;
  }
  return out.subarray(0, n);
}

export function curseforgeFingerprint(data: Uint8Array): number {
  return murmur2(stripWhitespace(data), 1);
}
