// Извлекает русские строки интерфейса и генерирует словари локализации
// через открытый LibreTranslate (translate.disroot.org), пакетами по строкам.
import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'fr', 'es', 'de', 'it', 'pl', 'sv', 'fi', 'uk', 'ko', 'ja', 'zh'];
const API = 'https://translate.disroot.org/translate';
const CACHE = path.resolve('scripts/.locale-cache.json');
const OUT = path.resolve('src/i18n/locales');
const BATCH = 18;

const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(full);
  }
}
walk(path.resolve('src'));

const strings = new Set();
for (const file of files) {
  if (file.includes(`${path.sep}i18n${path.sep}locales`)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gs)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    if (!raw.includes('${') && /[А-Яа-яЁё]/.test(raw)) add(unescape(raw));
  }
  for (const m of text.matchAll(/>([^<>{}]+)</g)) {
    const raw = m[1];
    if (/[А-Яа-яЁё]/.test(raw)) add(raw.replace(/\s+/g, ' ').trim());
  }
}

function unescape(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function add(s) {
  const v = s.trim();
  if (v.length < 2 || v.length > 800) return;
  if (!/[А-Яа-яЁё]/.test(v)) return;
  if (/^\d+$/.test(v)) return;
  strings.add(v);
}

const list = [...strings];
console.log('строк для перевода:', list.length);

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
} catch {
  cache = {};
}
fs.mkdirSync(OUT, { recursive: true });

async function request(texts, target) {
  const body = new URLSearchParams();
  body.set('q', texts.join('\n'));
  body.set('source', 'ru');
  body.set('target', target);
  body.set('format', 'text');
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const translated = String(json.translatedText ?? '');
  if (!translated) throw new Error('пустой перевод');
  return translated;
}

/** Переводит пачку; при несовпадении числа строк — по одной. */
async function translateBatch(texts, target) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const joined = await request(texts, target);
      const parts = joined.split('\n');
      if (parts.length === texts.length && parts.every((p) => p.trim())) return parts;
      break;
    } catch (e) {
      if (attempt === 2) break;
      await sleep(700 * (attempt + 1));
    }
  }
  const single = [];
  for (const text of texts) {
    let value = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        value = (await request([text], target)).trim();
        break;
      } catch {
        await sleep(400);
      }
    }
    single.push(value);
  }
  return single;
}

let done = 0;
let failed = 0;
const started = Date.now();
const jobs = [];
for (const lang of LANGS) {
  const pending = list.filter((text) => !cache[`${lang}\u0000${text}`]);
  for (let i = 0; i < pending.length; i += BATCH) {
    jobs.push({ lang, texts: pending.slice(i, i + BATCH) });
  }
}
console.log('пакетов:', jobs.length);

let index = 0;
async function worker() {
  for (;;) {
    const job = jobs[index++];
    if (!job) return;
    const parts = await translateBatch(job.texts, job.lang);
    job.texts.forEach((text, i) => {
      if (parts[i]) cache[`${job.lang}\u0000${text}`] = parts[i].trim();
      else failed++;
    });
    done += job.texts.length;
    if (done % 90 === 0 || index === jobs.length) {
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      const sec = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`${done}/${list.length * LANGS.length} (${sec} c), ошибок: ${failed}`);
    }
    await sleep(120);
  }
}

await Promise.all(Array.from({ length: 3 }, worker));
fs.writeFileSync(CACHE, JSON.stringify(cache));

for (const lang of LANGS) {
  const dict = {};
  for (const text of list) {
    const key = `${lang}\u0000${text}`;
    if (cache[key]) dict[text] = cache[key];
  }
  fs.writeFileSync(path.join(OUT, `${lang}.json`), JSON.stringify(dict, null, 0) + '\n');
  console.log(lang, Object.keys(dict).length);
}
console.log('готово');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}