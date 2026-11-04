// Скачивает шрифты (woff2) и генерирует src/styles/generated-fonts.css.
// Все выбранные семейства — OFL 1.1, встраивание разрешено.
// У каждого шрифта обязательно есть и кириллица, и латиница — иначе скрипт падает.
import fs from 'node:fs';
import path from 'node:path';

const FAMILIES = [
  { id: 'onest', name: 'Onest', query: 'Onest:wght@100..900' },
  { id: 'inter', name: 'Inter', query: 'Inter:wght@100..900' },
  { id: 'manrope', name: 'Manrope', query: 'Manrope:wght@200..800' },
  { id: 'montserrat', name: 'Montserrat', query: 'Montserrat:wght@100..900' },
  { id: 'nunito', name: 'Nunito', query: 'Nunito:wght@200..900' },
  { id: 'rubik', name: 'Rubik', query: 'Rubik:wght@300..900' },
  { id: 'exo2', name: 'Exo 2', query: 'Exo+2:wght@100..900' },
  { id: 'comfortaa', name: 'Comfortaa', query: 'Comfortaa:wght@300..700' },
  { id: 'lora', name: 'Lora', query: 'Lora:wght@400..700' },
  { id: 'playfair', name: 'Playfair Display', query: 'Playfair+Display:wght@400..900' },
  { id: 'caveat', name: 'Caveat', query: 'Caveat:wght@400..700' },
  { id: 'jetbrains', name: 'JetBrains Mono', query: 'JetBrains+Mono:wght@100..800' }
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const outDir = path.resolve('resources/public/fonts');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']);
let css = '/* Файл сгенерирован scripts/fetch-fonts.mjs. Шрифты OFL 1.1. */\n';

for (const fam of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${fam.query}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${fam.name}: HTTP ${res.status}`);
  const text = await res.text();
  // Название набора символов стоит в комментарии ПЕРЕД своим @font-face
  const blocks = [...text.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)];
  const got = new Set();
  for (const [, subset, body] of blocks) {
    if (!KEEP_SUBSETS.has(subset)) continue;
    const weight = body.match(/font-weight:\s*([^;]+);/)?.[1]?.trim() ?? '400';
    const srcUrl = body.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!srcUrl) continue;
    const bytes = Buffer.from(await (await fetch(srcUrl, { headers: { 'User-Agent': UA } })).arrayBuffer());
    const fileName = `${fam.id}-${subset}-${weight.replace(/\D+/g, '-')}.woff2`;
    fs.writeFileSync(path.join(outDir, fileName), bytes);
    got.add(subset);
    css += `@font-face{font-family:'${fam.name}';font-style:normal;font-weight:${weight};font-display:swap;src:url('../fonts/${fileName}') format('woff2');`;
    if (range) css += `unicode-range:${range};`;
    css += '}\n';
  }
  if (!got.has('cyrillic') || !got.has('latin')) throw new Error(`${fam.name}: нет кириллицы или латиницы (${[...got]})`);
  console.log('ok', fam.name, [...got].join(','));
}

fs.writeFileSync(path.resolve('src/styles/generated-fonts.css'), css, 'utf8');
console.log('готово, файлов:', fs.readdirSync(outDir).length);
