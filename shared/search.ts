/**
 * Нечёткий поиск: опечатки, другая раскладка клавиатуры и запросы «своими
 * словами». Используется в поиске по лаунчеру (гайды, настройки, сборки) и
 * для каталога модов (русский запрос → английские термины Modrinth).
 */

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN_TO_RU = new Map([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = new Map([...RU].map((c, i) => [c, EN[i]]));

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s.+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Текст, набранный не в той раскладке: «ыщвшгь» ↔ «sodium». */
export function switchLayout(text: string): string {
  const lower = text.toLowerCase();
  const cyr = (lower.match(/[а-яё]/g) ?? []).length;
  const lat = (lower.match(/[a-z]/g) ?? []).length;
  const map = cyr >= lat ? RU_TO_EN : EN_TO_RU;
  return [...lower].map((c) => map.get(c) ?? c).join('');
}

/** Похоже ли слово на латиницу/кириллицу, набранную в чужой раскладке. */
export function isLikelyWrongLayout(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-zа-яё]/g, '');
  if (t.length < 3) return false;
  if (/^[a-z]+$/.test(t)) {
    // Латиница без гласных или с характерными для «русской» латиницы буквосочетаниями
    const vowels = (t.match(/[aeiouy]/g) ?? []).length;
    return vowels / t.length < 0.2 || /[;'\[\]]/.test(text);
  }
  if (/^[а-яё]+$/.test(t)) {
    const switched = switchLayout(t);
    const vowels = (switched.match(/[aeiouy]/g) ?? []).length;
    // В «перевёрнутом» тексте английские гласные и мало редких русских букв
    return vowels / switched.length >= 0.25 && /[щшжхъэю]/.test(t);
  }
  return false;
}

/** Расстояние Дамерау–Левенштейна (перестановка соседних букв — одна ошибка). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Сколько опечаток допускаем в слове такой длины. */
export function allowedTypos(word: string): number {
  if (word.length <= 3) return 0;
  if (word.length <= 6) return 1;
  return 2;
}

/**
 * Насколько слово запроса совпадает со словом из текста:
 * 1 — точно, 0.8 — начало слова, 0.6 — с опечаткой, 0 — нет.
 */
export function wordMatch(query: string, word: string): number {
  if (query === word) return 1;
  if (query.length >= 3 && word.startsWith(query)) return 0.8;
  if (word.length >= 4 && query.startsWith(word)) return 0.7;
  const typos = allowedTypos(query);
  if (typos && editDistance(query, word, typos) <= typos) return 0.6;
  // Опечатка в начале длинного слова: «оптимизайия» ~ «оптимизац…»
  if (query.length >= 6 && word.length >= 6 && editDistance(query.slice(0, word.length), word, typos) <= typos) return 0.5;
  return 0;
}

/* ------------------------- Русский запрос → Modrinth ------------------------- */

/**
 * Словарь «как говорят игроки» → английские слова, которые есть в названиях
 * и описаниях модов на Modrinth. Ключ — основа слова (начало), значение —
 * поисковый термин.
 */
const CATALOG_TERMS: [string, string][] = [
  // названия популярных модов кириллицей и транслитом
  ['натри', 'sodium'],
  ['содиум', 'sodium'],
  ['содим', 'sodium'],
  ['ирис', 'iris'],
  ['айрис', 'iris'],
  ['литиум', 'lithium'],
  ['литий', 'lithium'],
  ['оптифайн', 'optifine'],
  ['оптифаин', 'optifine'],
  ['фабрик', 'fabric'],
  ['форж', 'forge'],
  ['неофорж', 'neoforge'],
  ['джеи', 'jei'],
  ['журнимап', 'journeymap'],
  ['джорнимап', 'journeymap'],
  ['ксаеро', 'xaero'],
  ['ксеро', 'xaero'],
  ['модменю', 'modmenu'],
  ['эмбеддиум', 'embeddium'],
  ['крейт', 'create'],
  ['ферст', 'ferritecore'],
  ['апплайд', 'applied energistics'],
  ['ботани', 'botania'],
  ['вейстоун', 'waystones'],
  ['вэйстоун', 'waystones'],
  ['джейд', 'jade'],
  ['хвайл', 'jade'],
  ['вайла', 'wthit'],
  // темы и жанры
  ['оптимиз', 'optimization'],
  ['производит', 'performance'],
  ['фпс', 'fps'],
  ['лаг', 'performance'],
  ['тормоз', 'performance'],
  ['ускор', 'performance'],
  ['миникарт', 'minimap'],
  ['карт', 'map'],
  ['шейдер', 'shaders'],
  ['шейдр', 'shaders'],
  ['тени', 'shadows'],
  ['освещ', 'lighting'],
  ['динамическ', 'dynamic'],
  ['свет', 'lights'],
  ['текстур', 'textures'],
  ['ресурспак', 'resource pack'],
  ['реалист', 'realistic'],
  ['мебел', 'furniture'],
  ['декор', 'decoration'],
  ['украш', 'decoration'],
  ['строит', 'building'],
  ['постро', 'building'],
  ['магия', 'magic'],
  ['магич', 'magic'],
  ['заклин', 'spells'],
  ['технолог', 'technology'],
  ['техник', 'technology'],
  ['механиз', 'machines'],
  ['энерг', 'energy'],
  ['автоматиз', 'automation'],
  ['приключ', 'adventure'],
  ['подземел', 'dungeons'],
  ['данж', 'dungeons'],
  ['структур', 'structures'],
  ['деревн', 'villages'],
  ['житель', 'villagers'],
  ['биом', 'biomes'],
  ['генерац', 'world generation'],
  ['мир', 'world'],
  ['пещер', 'caves'],
  ['горы', 'mountains'],
  ['дерев', 'trees'],
  ['моб', 'mobs'],
  ['монстр', 'monsters'],
  ['босс', 'bosses'],
  ['дракон', 'dragons'],
  ['живот', 'animals'],
  ['питом', 'pets'],
  ['зомби', 'zombie'],
  ['еда', 'food'],
  ['еду', 'food'],
  ['готов', 'cooking'],
  ['ферм', 'farming'],
  ['урож', 'crops'],
  ['оруж', 'weapons'],
  ['меч', 'swords'],
  ['пушк', 'guns'],
  ['огнестрел', 'guns'],
  ['брон', 'armor'],
  ['доспех', 'armor'],
  ['инструмент', 'tools'],
  ['инвентар', 'inventory'],
  ['сундук', 'chests'],
  ['хранил', 'storage'],
  ['рецепт', 'recipes'],
  ['крафт', 'crafting'],
  ['квест', 'quests'],
  ['голос', 'voice chat'],
  ['войс', 'voice chat'],
  ['чат', 'chat'],
  ['зум', 'zoom'],
  ['приблиз', 'zoom'],
  ['интерфейс', 'gui'],
  ['меню', 'menu'],
  ['звук', 'sounds'],
  ['музык', 'music'],
  ['анимац', 'animations'],
  ['машин', 'vehicles'],
  ['транспорт', 'vehicles'],
  ['поезд', 'trains'],
  ['самол', 'planes'],
  ['корабл', 'ships'],
  ['лодк', 'boats'],
  ['скин', 'skins'],
  ['плащ', 'capes'],
  ['одежд', 'cosmetics'],
  ['библиотек', 'library'],
  ['апи', 'api'],
  ['утилит', 'utility'],
  ['мини-игр', 'minigames'],
  ['хардкор', 'hardcore'],
  ['выживан', 'survival'],
  ['сложност', 'difficulty'],
  ['модпак', 'modpack'],
  ['сборк', 'modpack']
];

const CATALOG_STOP = new Set([
  'мод', 'моды', 'модов', 'мода', 'для', 'на', 'в', 'и', 'с', 'как', 'чтобы', 'хочу', 'нужен', 'нужна', 'нужно',
  'мне', 'который', 'которая', 'которое', 'майнкрафт', 'minecraft', 'игры', 'игра', 'новые', 'новый', 'новая',
  'добавляет', 'добавить', 'больше', 'много', 'лучше', 'лучший', 'типа', 'вроде', 'какой', 'какие', 'есть'
]);

/** Фразы из нескольких слов, которые надо понимать как одно слово. */
const PHRASES: [RegExp, string][] = [
  [/мини[\s-]?карт/g, 'миникарт'],
  [/голосов\S*\s+чат/g, 'войсчат'],
  [/войс\s*чат/g, 'войсчат'],
  [/динамическ\S*\s+(свет|освещ)\S*/g, 'динамсвет'],
  [/fabric\s*api/g, 'fabricapi'],
  [/фабрик\s*апи/g, 'fabricapi']
];
const PHRASE_TERMS: Record<string, string> = {
  миникарт: 'minimap',
  войсчат: 'voice chat',
  динамсвет: 'dynamic lights',
  fabricapi: 'fabric api'
};

/**
 * Жанровые слова → категории Modrinth. Если весь запрос — жанр
 * («оптимизация», «моды на магию»), искать лучше по категории и
 * популярности, чем по словам в названии.
 */
const CATEGORY_TERMS: Record<string, string> = {
  // Только широкие темы: у узких («мебель», «магия») категории на Modrinth
  // проставлены неаккуратно, и поиск по словам находит точнее
  optimization: 'optimization',
  performance: 'optimization',
  fps: 'optimization',
  library: 'library'
};

/**
 * Популярные моды: опечатки в их названиях исправляем сами — поиск
 * Modrinth прощает опечатки не всегда («sodum» не находит Sodium).
 */
const POPULAR = [
  'sodium', 'lithium', 'iris', 'fabric api', 'modmenu', 'jei', 'rei', 'emi', 'journeymap', 'xaero', 'create',
  'ferritecore', 'entityculling', 'immediatelyfast', 'modernfix', 'appleskin', 'waystones', 'jade', 'wthit',
  'distant horizons', 'simple voice chat', 'mouse tweaks', 'inventory profiles', 'cloth config', 'architectury',
  'geckolib', 'terralith', 'tectonic', 'continuity', 'indium', 'sodium extra', 'zoomify', 'bobby', 'krypton',
  'c2me', 'optifine', 'embeddium', 'oculus', 'botania', 'mekanism', 'farmers delight', 'supplementaries',
  'twilight forest', 'alexs mobs', 'biomes o plenty', 'origins', 'essential', 'replay mod', 'litematica',
  'minihud', 'tweakeroo', 'worldedit', 'voxelmap', 'lambdynamiclights', 'dynamic lights', 'better clouds',
  'falling leaves', 'ambientsounds', 'presence footsteps', 'nvidium', 'entity texture features', 'yacl'
];

function fixPopularTypo(word: string): string | null {
  if (word.length < 4) return null;
  let best: { name: string; d: number } | null = null;
  for (const name of POPULAR) {
    if (name.includes(' ')) continue;
    const max = allowedTypos(name);
    const d = editDistance(word, name, max);
    if (d > 0 && d <= max && (!best || d < best.d)) best = { name, d };
  }
  return best?.name ?? null;
}

/** Категория Modrinth, если запрос целиком жанровый. */
export function catalogCategory(raw: string): string | null {
  const first = catalogQueries(raw)[0];
  const words = first.split(' ').filter(Boolean);
  if (!words.length) return null;
  const joined = words.join(' ');
  if (CATEGORY_TERMS[joined]) return CATEGORY_TERMS[joined];
  const cats = new Set(words.map((w) => CATEGORY_TERMS[w]));
  if (cats.size === 1 && !cats.has(undefined as unknown as string)) return [...cats][0];
  return null;
}

/**
 * Варианты запроса для каталога модов: перевод русских слов в английские
 * термины, исправление раскладки и опечаток в названиях. Первый вариант —
 * основной.
 */
export function catalogQueries(raw: string): string[] {
  let query = normalizeText(raw);
  if (!query) return [raw];
  for (const [re, rep] of PHRASES) query = query.replace(re, rep);
  const out: string[] = [];
  const add = (q: string) => {
    const t = [...new Set(q.trim().split(/\s+/))].join(' ');
    if (t && !out.includes(t)) out.push(t);
  };

  const words = query.split(' ').filter((w) => w && !CATALOG_STOP.has(w));
  const mapped: string[] = [];
  let unknown = 0;
  for (const w of words) {
    const term = PHRASE_TERMS[w] ?? (/[а-я]/.test(w) ? catalogTerm(w) : null);
    if (term) mapped.push(term);
    else if (/[а-я]/.test(w)) {
      // Возможно, набрано в русской раскладке: «ыщвшгь» → «sodium»
      const switched = switchLayout(w);
      const popular = POPULAR.includes(switched) ? switched : fixPopularTypo(switched);
      if (popular) mapped.push(popular);
      else unknown++;
    } else mapped.push(fixPopularTypo(w) ?? w);
  }
  if (mapped.length) add(mapped.join(' '));
  if (unknown === words.length && words.length) add(switchLayout(query));
  else if (!/[а-я]/.test(query) && isLikelyWrongLayout(query)) add(switchLayout(query));
  add(query);
  return out;
}
function catalogTerm(word: string): string | null {
  // Сначала точное начало слова, потом — с опечаткой
  let best: { term: string; len: number } | null = null;
  for (const [stem, term] of CATALOG_TERMS) {
    if (word.startsWith(stem) && (!best || stem.length > best.len)) best = { term, len: stem.length };
  }
  if (best) return best.term;
  if (word.length >= 5) {
    for (const [stem, term] of CATALOG_TERMS) {
      if (stem.length >= 4 && editDistance(word.slice(0, stem.length), stem, 1) <= 1) return term;
    }
  }
  return null;
}
