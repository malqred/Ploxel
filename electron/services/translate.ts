import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './paths';
import { translateMarkdown } from '../core/md-translate';
import { normalizeMarkdown } from '../../shared/markdown';

/**
 * Перевод описаний проектов на язык лаунчера. ИИ здесь не используется —
 * токены пользователя на перевод не тратятся. Цепочка:
 *   1. Google Translate (публичный адрес translate.googleapis.com, без ключа и
 *      без дневного лимита) — основной;
 *   2. MyMemory — 5 000 символов в день; после HTTP 429 до сброса не обращаемся;
 *   3. LibreTranslate (translate.disroot.org) — 3 запроса в минуту.
 * Результаты кешируются в памяти и на диске.
 */

const MM_CODE: Record<string, string> = { zh: 'zh-CN', en: 'en-GB' };
const GOOGLE_CODE: Record<string, string> = { zh: 'zh-CN' };
const LIBRE_CODE: Record<string, string> = { zh: 'zh-Hans' };
const LIBRE_URL = 'https://translate.disroot.org/translate';
/** До какого момента MyMemory не принимает запросы (дневной лимит) */
let myMemoryBlockedUntil = 0;

class QuotaError extends Error {}
const cache = new Map<string, TranslateResult>();
const DISK_LIMIT = 300;
let diskLoaded = false;

/** Кэш на диске: повторное открытие страницы не тратит дневной лимит переводчика. */
function cacheFile(): string {
  return path.join(getRoot(), 'cache', 'translations.json');
}
function loadDiskCache() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, TranslateResult>;
    for (const [k, v] of Object.entries(raw)) cache.set(k, v);
  } catch {
    /* кэша ещё нет */
  }
}
function saveDiskCache() {
  try {
    const entries = [...cache.entries()].filter(([, v]) => !v.truncated).slice(-DISK_LIMIT);
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(Object.fromEntries(entries)), 'utf8');
  } catch {
    /* кэш не критичен */
  }
}
const MAX_MEMORY = 4200;

export interface TranslateResult {
  text: string;
  provider: 'google' | 'mymemory' | 'libre';
  truncated: boolean;
}

/** Строка-разделитель без букв: переводчики её не трогают */
const PAGE_SPLIT = '⁂⁂⁂';

/**
 * Перевод страницы целиком (аннотация + описание) одним заходом: так
 * запасному переводчику с лимитом запросов хватает квоты на всю страницу.
 */
export async function translatePage(
  summary: string,
  body: string,
  target: string
): Promise<{ summary: string; body: string; provider: TranslateResult['provider']; truncated: boolean }> {
  const joined = [summary.trim(), PAGE_SPLIT, body].join('\n\n');
  const res = await translateText(joined, target);
  const idx = res.text.indexOf(PAGE_SPLIT);
  if (idx < 0) return { summary, body: res.text, provider: res.provider, truncated: res.truncated };
  return {
    summary: res.text.slice(0, idx).trim(),
    body: res.text.slice(idx + PAGE_SPLIT.length).trim(),
    provider: res.provider,
    truncated: res.truncated
  };
}

export async function translateText(raw: string, target: string): Promise<TranslateResult> {
  const text = normalizeMarkdown(raw);
  if (!text) return { text: '', provider: 'mymemory', truncated: false };
  if (target === 'ru' && detectSource(text) === 'ru') {
    return { text, provider: 'mymemory', truncated: false };
  }
  const key = `${target}:${hash(text)}:${text.length}`;
  loadDiskCache();
  const hit = cache.get(key);
  if (hit) return hit;

  const source = detectSource(text);
  if ((MM_CODE[target] ?? target).startsWith(source)) return { text, provider: 'mymemory', truncated: false };

  let out: TranslateResult | null = null;
  let failed = true;
  try {
    const g = await translateMarkdown(text, (chunk) => google(chunk, GOOGLE_CODE[target] ?? target), {
      limit: 1800,
      concurrency: 4
    });
    if (!g.failed) {
      out = { text: g.text, provider: 'google', truncated: false };
      failed = false;
    }
  } catch (e) {
    console.warn('[translate] Google не сработал', e);
  }
  if (!out && Date.now() >= myMemoryBlockedUntil) {
    try {
      const mm = await translateMarkdown(
        text,
        (chunk) => myMemory(chunk, source, MM_CODE[target] ?? target),
        { limit: 450, budget: MAX_MEMORY, concurrency: 4 }
      );
      // Лимит кончился посреди страницы — переводим заново запасным
      if (Date.now() >= myMemoryBlockedUntil) {
        out = { text: mm.text, provider: 'mymemory', truncated: !mm.complete };
        failed = mm.failed;
      }
    } catch (e) {
      if (!(e instanceof QuotaError)) console.warn('[translate] MyMemory не сработал', e);
    }
  }
  if (!out) {
    const libre = await translateMarkdown(
      text,
      (chunk) => libreTranslate(chunk, source, LIBRE_CODE[target] ?? target),
      { limit: 950, budget: 2800, concurrency: 3 }
    );
    out = { text: libre.text, provider: 'libre', truncated: !libre.complete };
    failed = libre.failed;
  }
  // Перевод со сбоями (лимит, сеть) не кэшируем — при следующем открытии повторим
  if (!failed) {
    cache.set(key, out);
    saveDiskCache();
  }
  return out;
}

/** Публичный адрес Google Translate: без ключа, ограничена только частота запросов. */
async function google(text: string, target: string): Promise<string> {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json) || !Array.isArray(json[0])) throw new Error('Google вернул пустой ответ');
  const out = (json[0] as unknown[])
    .map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
    .join('');
  if (!out.trim()) throw new Error('Google вернул пустой ответ');
  return out;
}

async function myMemory(text: string, source: string, target: string): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: `${source}|${target}` });
  const url = `https://api.mymemory.translated.net/get?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  // 429 — дневной лимит: запоминаем, когда он сбросится (Retry-After, секунды)
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 3600;
    myMemoryBlockedUntil = Date.now() + Math.min(wait, 86400) * 1000;
    throw new QuotaError('MyMemory: дневной лимит исчерпан');
  }
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const json = (await res.json()) as {
    responseStatus: number | string;
    responseData?: { translatedText?: string };
    responseDetails?: string;
    quotaFinished?: boolean;
  };
  if (json.quotaFinished || /USED ALL AVAILABLE FREE TRANSLATIONS/i.test(String(json.responseDetails ?? ''))) {
    myMemoryBlockedUntil = Date.now() + 3600 * 1000;
    throw new QuotaError('MyMemory: дневной лимит исчерпан');
  }
  const translated = json.responseData?.translatedText;
  if (!translated || Number(json.responseStatus) !== 200) {
    throw new Error('Переводчик вернул пустой ответ');
  }
  return translated.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

async function libreTranslate(text: string, source: string, target: string): Promise<string> {
  const res = await fetch(LIBRE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source, target, format: 'text' }),
    signal: AbortSignal.timeout(30000)
  });
  if (res.status === 429) {
    throw new Error(
      'Переводчики сейчас недоступны или перегружены. Попробуйте через минуту.'
    );
  }
  if (!res.ok) throw new Error(`Переводчик недоступен (HTTP ${res.status})`);
  const json = (await res.json()) as { translatedText?: string };
  if (!json.translatedText) throw new Error('Переводчик вернул пустой ответ');
  return json.translatedText;
}

function detectSource(text: string): string {
  const letters = text.match(/[A-Za-zА-Яа-яЁё]/g)?.length ?? 0;
  const cyr = text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  return letters && cyr / letters > 0.3 ? 'ru' : 'en';
}

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return String(h);
}

