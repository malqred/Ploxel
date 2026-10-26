/**
 * Перевод markdown без поломки разметки.
 *
 * Машинный переводчик получает только текст строк: префиксы (#, -, 1., >),
 * блоки кода, таблицы и линии остаются как есть. Ссылки, инлайн-код и
 * короткие названия (Sodium, Fabric Loader) заменяются метками [L0] — их
 * переводчик сохраняет, а потом метки возвращаются на место. Строки уходят
 * пачками через перевод строки: так меньше запросов и сохраняется контекст.
 */

export type BatchTranslator = (text: string) => Promise<string>;

interface Line {
  prefix: string;
  content: string;
  /** Метки [Ln] → исходный markdown */
  tokens: string[];
  /** Адреса переводимых ссылок по порядку */
  urls: string[];
  translate: boolean;
}

const PREFIX = /^(\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)*)/;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE = /`[^`\n]+`/g;
const BARE_URL = /\bhttps?:\/\/[^\s)]+/g;
/** Названия, которые переводчики «переводят» (Fabric → Ткань, Sodium → Натрий). */
const GLOSSARY =
  /\b(?:Fabric|Quilt|NeoForge|Forge|LiteLoader)(?: (?:Loader|API))?\b|\b(?:Minecraft|Modrinth|CurseForge|Mojang|OptiFine|Sodium|Lithium|Iris|Indium|Phosphor|Starlight|Mod Menu|Cloth Config|Architectury|Jade)\b/g;

export function prepareLines(markdown: string): Line[] {
  const lines = markdown.split('\n');
  const out: Line[] = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const keep = (): Line => ({ prefix: raw, content: '', tokens: [], urls: [], translate: false });
    if (raw.trimStart().startsWith('```')) {
      inCode = !inCode;
      out.push(keep());
      continue;
    }
    if (inCode || !raw.trim() || raw.includes('|') && isTableLine(lines, i) || /^\s*([-*_])\s*\1\s*\1[\s*_-]*$/.test(raw)) {
      out.push(keep());
      continue;
    }
    const prefix = raw.match(PREFIX)?.[1] ?? '';
    let content = raw.slice(prefix.length);
    const tokens: string[] = [];
    const urls: string[] = [];
    const protect = (value: string) => {
      tokens.push(value);
      return `[L${tokens.length - 1}]`;
    };
    content = content.replace(CODE, (m) => protect(m));
    content = content.replace(LINK, (m, label: string, url: string) => {
      if (isName(label)) return protect(m);
      urls.push(url);
      return `[${label}]`;
    });
    content = content.replace(BARE_URL, (m) => protect(m));
    // Названия вне подписей ссылок — подписи переводятся целиком
    content = content
      .split(/(\[[^\]\n]*\])/)
      .map((part) => (part.startsWith('[') ? part : part.replace(GLOSSARY, (m) => protect(m))))
      .join('');
    const translate = /\p{L}{2,}/u.test(content.replace(/\[L\d+\]/g, ''));
    out.push({ prefix, content, tokens, urls, translate });
  }
  return out;
}

export function restoreLine(line: Line, translated: string): string {
  let text = translated.trim();
  // Переводчики любят пробелы внутри ** и __
  text = text.replace(/\*\*\s+([^*]+?)\s+\*\*/g, '**$1**').replace(/\*\*\s+([^*]+?)\*\*/g, '**$1**');
  text = text.replace(/\[\s*L\s*(\d+)\s*\]/gi, (m, n: string) => line.tokens[Number(n)] ?? m);
  const labels = [...text.matchAll(/\[([^\]\n]+)\](?!\()/g)];
  if (labels.length === line.urls.length) {
    let idx = 0;
    text = text.replace(/\[([^\]\n]+)\](?!\()/g, (_m, label: string) => `[${label}](${line.urls[idx++]})`);
  } else if (line.urls.length) {
    // Переводчик потерял скобки — ссылки превращаются в обычный текст
    text = text.replace(/\[([^\]\n]+)\](?!\()/g, '$1');
  }
  return line.prefix + text;
}

/**
 * Переводит markdown. `limit` — сколько символов текста отдавать
 * переводчику за раз, `budget` — сколько всего (остальное остаётся
 * оригиналом, без обрезки).
 */
export async function translateMarkdown(
  markdown: string,
  translateBatch: BatchTranslator,
  opts: { limit?: number; budget?: number; concurrency?: number } = {}
): Promise<{ text: string; complete: boolean; failed: boolean }> {
  const limit = opts.limit ?? 450;
  const budget = opts.budget ?? Infinity;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const lines = prepareLines(markdown);
  // По умолчанию — оригинал строки (метки возвращаются на место)
  const result = lines.map((l) => restoreLine(l, l.content));
  let spent = 0;
  let complete = true;

  // Длинные строки режем по предложениям: у MyMemory лимит ~500 байт на запрос
  const segments: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.translate) continue;
    if (spent + line.content.length > budget) {
      complete = false;
      break;
    }
    spent += line.content.length;
    for (const text of splitLong(line.content, limit)) segments.push({ line: i, text });
  }

  const batches: number[][] = [];
  let current: number[] = [];
  let size = 0;
  segments.forEach((seg, idx) => {
    const len = byteLength(seg.text) + 1;
    if (current.length && size + len > limit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(idx);
    size += len;
  });
  if (current.length) batches.push(current);

  const out: string[] = segments.map((seg) => seg.text);
  let failed = 0;
  const runBatch = async (batch: number[]) => {
    const pieces = batch.map((i) => segments[i].text);
    try {
      let translated: string[];
      if (pieces.length === 1) {
        translated = [await translateBatch(pieces[0])];
      } else {
        translated = (await translateBatch(pieces.join('\n'))).split('\n').filter((x) => x.trim());
        if (translated.length !== pieces.length) {
          // Переводчик склеил или разбил строки — переводим по одной
          translated = await Promise.all(pieces.map((piece) => translateBatch(piece)));
        }
      }
      batch.forEach((segIdx, k) => (out[segIdx] = translated[k] ?? out[segIdx]));
    } catch (e) {
      // Пачка не перевелась — её текст остаётся оригиналом
      failed++;
      if (failed === batches.length) throw e;
    }
  };
  // Пачки идут параллельно — так длинная страница переводится за пару секунд
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) await runBatch(batches[next++]);
    })
  );
  if (failed) complete = false;

  const byLine = new Map<number, string[]>();
  segments.forEach((seg, idx) => byLine.set(seg.line, [...(byLine.get(seg.line) ?? []), out[idx]]));
  for (const [lineIdx, parts] of byLine) result[lineIdx] = restoreLine(lines[lineIdx], parts.join(' '));
  return { text: result.join('\n'), complete, failed: failed > 0 };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Делит текст на куски не длиннее limit байт: по предложениям, затем по словам. */
export function splitLong(text: string, limit: number): string[] {
  if (byteLength(text) <= limit) return [text];
  const parts: string[] = [];
  let cur = '';
  const push = (piece: string) => {
    const candidate = cur ? `${cur} ${piece}` : piece;
    if (byteLength(candidate) <= limit) {
      cur = candidate;
      return;
    }
    if (cur) parts.push(cur);
    cur = '';
    if (byteLength(piece) <= limit) {
      cur = piece;
      return;
    }
    for (const word of piece.split(/\s+/)) {
      const c2 = cur ? `${cur} ${word}` : word;
      if (byteLength(c2) <= limit) cur = c2;
      else {
        if (cur) parts.push(cur);
        cur = word;
      }
    }
  };
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) push(sentence);
  if (cur) parts.push(cur);
  return parts;
}

function isName(label: string): boolean {
  const words = label.trim().split(/\s+/);
  return words.length <= 3 && /^[A-Z0-9]/.test(label.trim()) && words.every((w) => /^[A-Z0-9]/.test(w) || w.length <= 3);
}

function isTableLine(lines: string[], i: number): boolean {
  const sep = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
  if (sep.test(lines[i])) return true;
  for (let j = i; j >= 0 && lines[j].includes('|'); j--) {
    if (sep.test(lines[j + 1] ?? '') || sep.test(lines[j])) return true;
  }
  for (let j = i; j < lines.length && lines[j].includes('|'); j++) {
    if (sep.test(lines[j])) return true;
  }
  return false;
}
