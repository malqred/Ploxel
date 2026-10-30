import fs from 'node:fs';
import path from 'node:path';

// config.json для установщика: публичные настройки из config.default.json
// и ключ CurseForge из локального config.json (он не в git) или переменной
// окружения PLOXEL_CURSEFORGE_KEY. Ключ не попадает в исходники и репозиторий.
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const base = read('config.default.json');
const local = read('config.json');
const key = process.env.PLOXEL_CURSEFORGE_KEY || local.curseforgeApiKey || '';
const out = { ...base, curseforgeApiKey: key };

const dir = path.join('dist', 'config');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`[release-config] готово, ключ CurseForge ${key ? 'есть' : 'НЕ задан — каталог CurseForge будет выключен'}`);
