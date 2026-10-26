// Скачивает шрифты (woff2) и генерирует src/styles/generated-fonts.css.
// Все выбранные семейства — OFL 1.1, встраивание разрешено.
import fs from 'node:fs';
import path from 'node:path';

const FAMILIES = [
  { id: 'onest', name: 'Onest', query: 'Onest:wght@100..900' },
  { id: 'inter', name: 'Inter', query: 'Inter:wght@100..900' },
  { id: 'manrope', name: 'Manrope', query: 'Manrope:wght@200..800' },
  { id: 'golos', name: 'Golos Text', query: 'Golos+Text:wght@400..900' },
  { id: 'nunito', name: 'Nunito', query: 'Nunito:wght@200..900' },
  { id: 'rubik', name: 'Rubik', query: 'Rubik:wght@300..900' },
  { id: 'montserrat', name: 'Montserrat', query: 'Montserrat:wght@100..900' },
  { id: 'ptsans', name: 'PT Sans', query: 'PT+Sans:wght@400;700' },
  { id: 'comfortaa', name: 'Comfortaa', query: 'Comfortaa:wght@300..700' },
  { id: 'lora', name: 'Lora', query: 'Lora:wght@400..700' },
  { id: 'ptserif', name: 'PT Serif', query: 'PT+Serif:wght@400;700' },
  { id: 'playfair', name: 'Playfair Display', query: 'Playfair+Display:wght@400..900' },
  { id: 'cormorant', name: 'Cormorant Garamond', query: 'Cormorant+Garamond:wght@300..700' },
  { id: 'merriweather', name: 'Merriweather', query: 'Merriweather:wght@300..900' },
  { id: 'jetbrains', name: 'JetBrains Mono', query: 'JetBrains+Mono:wght@100..800' }
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const outDir = path.resolve('resources/public/fonts');
fs.mkdirSync(outDir, { recursive: true });

const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']);
let css = '/* Файл сгенерирован scripts/fetch-fonts.mjs. Шрифты OFL 1.1. */\n';

for (const fam of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${fam.query}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.warn('skip', fam.name, res.status);
    continue;
  }
  const text = await res.text();
  const blocks = text.split('@font-face').slice(1);
  let order = 0;
  for (const raw of blocks) {
    const subsetMatch = raw.match(/\/\*\s*([a-z-]+)\s*\*\//);
    const subset = subsetMatch?.[1] ?? 'latin';
    if (!KEEP_SUBSETS.has(subset)) continue;
    const weight = raw.match(/font-weight:\s*([^;]+);/)?.[1]?.trim() ?? '400';
    const srcUrl = raw.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = raw.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!srcUrl) continue;
    const bytes = Buffer.from(await (await fetch(srcUrl, { headers: { 'User-Agent': UA } })).arrayBuffer());
    const fileName = `${fam.id}-${subset}-${String(order++).replace(/\D/g, '') || 0}.woff2`;
    fs.writeFileSync(path.join(outDir, fileName), bytes);
    css += `@font-face{font-family:'${fam.name}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${fileName}') format('woff2');`;
    if (range) css += `unicode-range:${range};`;
    css += '}\n';
  }
  console.log('ok', fam.name);
}

fs.writeFileSync(path.resolve('src/styles/generated-fonts.css'), css, 'utf8');
console.log('готово, файлов:', fs.readdirSync(outDir).length);