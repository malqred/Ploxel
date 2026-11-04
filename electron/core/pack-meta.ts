// Описание пака из pack.mcmeta. В разных версиях игры это строка или
// текстовый компонент: объект { text, extra } или массив таких частей.

export function textComponentToString(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => textComponentToString(v, depth + 1)).join('');
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; translate?: unknown; extra?: unknown };
    const own = textComponentToString(obj.text ?? obj.translate ?? '', depth + 1);
    return own + textComponentToString(obj.extra ?? '', depth + 1);
  }
  return '';
}

/** Описание пака без цветовых кодов «§x»; пусто — описания нет или файл битый. */
export function packDescription(mcmeta: string): string {
  try {
    const json = JSON.parse(mcmeta.replace(/^﻿/, '')) as { pack?: { description?: unknown } };
    return textComponentToString(json.pack?.description).replace(/§./g, '').trim();
  } catch {
    return '';
  }
}
