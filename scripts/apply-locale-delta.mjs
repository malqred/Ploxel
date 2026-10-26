import fs from 'node:fs';
import path from 'node:path';

// Добавляет переводы новых строк в словари интерфейса. Перед запуском положите
// в scripts/locale-delta/ файлы new-ru.json (список ключей) и <язык>.json —
// после применения папку можно удалить.
// en.json — базовый: в нём должны быть все ключи. Остальные языки дополняются
// своими переводами, а отсутствующие ключи берутся из английского.
const OUT = 'src/i18n/locales';
const DELTA = 'scripts/locale-delta';
const LANGS = ['de', 'es', 'fr', 'it', 'pl', 'sv', 'fi', 'uk', 'ko', 'ja', 'zh'];

const source = JSON.parse(fs.readFileSync(path.join(DELTA, 'new-ru.json'), 'utf8'));
const enDelta = JSON.parse(fs.readFileSync(path.join(DELTA, 'en.json'), 'utf8'));
const enFile = path.join(OUT, 'en.json');
const en = { ...JSON.parse(fs.readFileSync(enFile, 'utf8')), ...enDelta };
fs.writeFileSync(enFile, JSON.stringify(en, null, 0) + '\n', 'utf8');
console.log('en:', Object.keys(en).length, 'ключей (+' + Object.keys(enDelta).length + ')');

for (const lang of LANGS) {
  const deltaFile = path.join(DELTA, `${lang}.json`);
  if (!fs.existsSync(deltaFile)) {
    console.warn(lang, '— нет файла перевода, пропуск');
    continue;
  }
  const delta = JSON.parse(fs.readFileSync(deltaFile, 'utf8'));
  const outFile = path.join(OUT, `${lang}.json`);
  const current = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const merged = { ...en, ...current };
  let added = 0;
  for (const key of source) {
    const value = delta[key];
    if (typeof value === 'string' && value.trim()) {
      merged[key] = value;
      added++;
    }
  }
  // Держим порядок и полноту как в en: ни один ключ не должен потеряться.
  const final = {};
  for (const key of Object.keys(en)) final[key] = merged[key] ?? en[key];
  fs.writeFileSync(outFile, JSON.stringify(final, null, 0) + '\n', 'utf8');
  const own = Object.entries(final).filter(([k, v]) => v && v !== en[k]).length;
  console.log(lang, 'добавлено:', added, 'всего:', Object.keys(final).length, 'своих:', own);
}

const missing = [];
for (const lang of LANGS) {
  const file = path.join(OUT, `${lang}.json`);
  if (!fs.existsSync(file)) continue;
  const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(en)) if (!(key in dict)) missing.push(`${lang}: ${key}`);
}
if (missing.length) {
  console.error('Не хватает ключей:', missing.length);
  process.exitCode = 1;
} else {
  console.log('Все словари содержат все ключи.');
}