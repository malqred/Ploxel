import { BASIC_GUIDES } from './basic';
import { ADVANCED_GUIDES } from './advanced';
import { EXTRA_GUIDES } from './extra';
import { CURRENT_GUIDES } from './current';
import { V120_GUIDES } from './v120';
import { COMMON_QUERIES } from './queries';
import type { Guide } from './types';
import { allowedTypos, editDistance, normalizeText, queryVariants, wordMatch } from '../../../shared/search';

export const GUIDES: Guide[] = [...BASIC_GUIDES, ...ADVANCED_GUIDES, ...EXTRA_GUIDES, ...CURRENT_GUIDES, ...V120_GUIDES];
export type { Guide, GuideSection } from './types';

const STOP = new Set([
  'как', 'мне', 'в', 'на', 'для', 'и', 'что', 'где', 'по', 'с', 'не', 'а', 'или', 'это', 'у', 'я', 'мы', 'же',
  'ли', 'бы', 'то', 'так', 'уже', 'все', 'всё', 'меня', 'мой', 'моя', 'мои', 'его', 'её', 'их', 'там', 'тут',
  'почему', 'зачем', 'когда', 'можно', 'нужно', 'надо', 'хочу', 'сделать', 'делать', 'есть', 'был', 'была',
  'могу', 'может', 'могут', 'через', 'получается', 'вообще', 'очень', 'просто', 'чтобы', 'какой', 'какая', 'какие',
  'из', 'от', 'до', 'при', 'про', 'об', 'о', 'со', 'ты', 'вы', 'он', 'она', 'они', 'этот', 'эта', 'эти', 'свой', 'свои',
  'the', 'a', 'to', 'how', 'do', 'i', 'my', 'is', 'of', 'in', 'for', 'and', 'with', 'on', 'what', 'why'
]);

/** Приведение слов к общему виду: «сборку», «сборки», «сборка» → «сборк». */
function stem(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/(ами|ями|ого|его|ому|ему|ыми|ими|ешь|ать|ять|ить|еть|ет|ут|ют|ит|ат|ят|ах|ях|ом|ем|ам|ям|ов|ев|ий|ый|ой|ая|яя|ое|ее|ые|ие|ы|и|а|я|у|ю|е|о|ь)$/u, '')
    .replace(/ё/g, 'е');
}

/**
 * Синонимы и разговорные слова → общее понятие. Ключ — основа слова
 * (после stem) или слово целиком; значение — понятие, которое встречается в
 * гайдах. Применяется и к запросу, и к тексту гайдов.
 */
const SYNONYMS: Record<string, string> = {
  // ИИ
  ai: 'ии', нейросет: 'ии', искусственн: 'ии', помощник: 'ии', gpt: 'ии', чатгпт: 'ии', chatgpt: 'ии', нейронк: 'ии',
  free: 'бесплатн', даром: 'бесплатн', бесплатн: 'бесплатн', халяв: 'бесплатн',
  // контент
  мод: 'мод', модик: 'мод', мода: 'мод', mod: 'мод', mods: 'мод', модификац: 'мод', аддон: 'мод',
  сборк: 'сборк', профил: 'сборк', инстанс: 'сборк', instance: 'сборк', клиент: 'сборк',
  ресурспак: 'ресурспак', текстурпак: 'ресурспак', текстур: 'ресурспак', resourcepack: 'ресурспак', рп: 'ресурспак',
  шейдер: 'шейдер', шейдр: 'шейдер', shader: 'шейдер', shaders: 'шейдер', графика: 'шейдер', граф: 'шейдер',
  модпак: 'модпак', modpack: 'модпак', mrpack: 'модпак',
  // установка
  установ: 'установ', постав: 'установ', скача: 'установ', скачив: 'установ', закин: 'установ', кин: 'установ', кид: 'установ', кида: 'установ', закид: 'установ', куда: 'установ',
  добав: 'установ', install: 'установ', загруз: 'установ', ставит: 'установ', ставл: 'установ', ставь: 'установ', выстав: 'установ',
  // Java и память
  java: 'java', джава: 'java', ява: 'java', jdk: 'java', jre: 'java',
  памят: 'памят', озу: 'памят', ram: 'памят', оперативк: 'памят', оператив: 'памят', гигабайт: 'памят', гб: 'памят',
  xmx: 'памят', выделен: 'памят', выдел: 'памят',
  // ошибки и тормоза
  вылет: 'ошибк', вылета: 'ошибк', краш: 'ошибк', крашит: 'ошибк', крашнул: 'ошибк', ошибк: 'ошибк', crash: 'ошибк',
  exception: 'ошибк', запуска: 'ошибк', открыва: 'ошибк', падает: 'ошибк', пада: 'ошибк', закрыва: 'ошибк',
  черн: 'ошибк', зависа: 'ошибк', завис: 'ошибк', баг: 'ошибк',
  тормоз: 'тормоз', лаг: 'тормоз', лага: 'тормоз', лагает: 'тормоз', фриз: 'тормоз', фриза: 'тормоз', фпс: 'тормоз',
  fps: 'тормоз', медлен: 'тормоз', производительн: 'тормоз', оптимизац: 'тормоз', виснет: 'тормоз', дерга: 'тормоз',
  // аккаунт
  скин: 'скин', skin: 'скин', шкурк: 'скин', облик: 'скин', плащ: 'скин', cape: 'скин',
  аккаунт: 'аккаунт', акк: 'аккаунт', учетн: 'аккаунт', вход: 'аккаунт', войт: 'аккаунт', логин: 'аккаунт',
  microsoft: 'аккаунт', майкрософт: 'аккаунт', мс: 'аккаунт', лицензи: 'аккаунт', xbox: 'аккаунт',
  офлайн: 'офлайн', оффлайн: 'офлайн', offline: 'офлайн', пиратк: 'офлайн', интернет: 'офлайн',
  // миры и сеть
  мир: 'мир', миры: 'мир', сейв: 'мир', сохранен: 'мир', карт: 'мир', world: 'мир', saves: 'мир',
  бэкап: 'бэкап', бекап: 'бэкап', backup: 'бэкап', резервн: 'бэкап', копи: 'бэкап',
  сервер: 'сервер', server: 'сервер', подключ: 'сервер', зайт: 'сервер', онлайн: 'сервер', айпи: 'сервер', ip: 'сервер',
  lan: 'lan', сет: 'lan', локалк: 'lan', локальн: 'lan', друзья: 'lan', друзьям: 'lan', друзьями: 'lan', вместе: 'lan',
  // оформление
  тема: 'тем', тем: 'тем', оформлен: 'тем', внешн: 'тем', цвет: 'тем', темн: 'тем', светл: 'тем', дизайн: 'тем',
  шрифт: 'шрифт', фон: 'фон', акцент: 'акцент',
  // поиск
  поиск: 'поиск', иск: 'поиск', найт: 'поиск', наход: 'поиск', нашел: 'поиск', ищ: 'поиск', иска: 'поиск', искат: 'поиск', search: 'поиск',
  // прочее
  обновлен: 'обновлен', обнов: 'обновлен', update: 'обновлен', апдейт: 'обновлен', откат: 'обновлен',
  антивирус: 'антивирус', вирус: 'антивирус', защитник: 'антивирус', defender: 'антивирус', smartscreen: 'антивирус',
  лог: 'лог', логи: 'лог', консол: 'лог', журнал: 'лог',
  верси: 'верси', version: 'верси', снапшот: 'верси', snapshot: 'верси', релиз: 'верси',
  загрузчик: 'загрузчик', fabric: 'загрузчик', фабрик: 'загрузчик', forge: 'загрузчик', форж: 'загрузчик',
  neoforge: 'загрузчик', quilt: 'загрузчик', квилт: 'загрузчик',
  зависимост: 'зависимост', библиотек: 'зависимост', dependency: 'зависимост', api: 'зависимост',
  конфликт: 'конфликт', несовместим: 'конфликт', несовмест: 'конфликт',
  // управление, обучение, удаление и хранилище
  клавиш: 'клавиш', управлен: 'клавиш', keybind: 'клавиш', keybinds: 'клавиш', hotkey: 'клавиш',
  сброс: 'сброс', сброш: 'сброс', ресет: 'сброс', reset: 'сброс',
  обучен: 'обучен', туториал: 'обучен', tutorial: 'обучен', знакомств: 'обучен',
  удален: 'удал', деинстал: 'удал', uninstall: 'удал', почист: 'удал',
  перенос: 'перенос', перенес: 'перенос',
  хранилищ: 'хранилищ', storage: 'хранилищ', диск: 'хранилищ', место: 'хранилищ', места: 'хранилищ', освобод: 'хранилищ',
  переместит: 'перенос', перемест: 'перенос', скопир: 'перенос', копирова: 'перенос',
  // 1.2: Ely.by, фон, снимки, поиск неисправностей, импорт, статистика, язык
  ely: 'ely', elyby: 'ely', 'ely.by': 'ely', элибай: 'ely', эли: 'ely', authlib: 'ely', тлаунчерск: 'ely',
  обои: 'фон', видео: 'фон', гиф: 'фон', gif: 'фон', картинк: 'фон', заставк: 'фон', wallpaper: 'фон', mp4: 'фон', webm: 'фон',
  снимк: 'снимк', снимок: 'снимк', скриншот: 'снимк', скрин: 'снимк', скрины: 'снимк', screenshot: 'снимк', f2: 'снимк', фотк: 'снимк',
  неисправн: 'неисправност', неисправност: 'неисправност', здоров: 'неисправност', проверк: 'неисправност', диагност: 'неисправност',
  починит: 'неисправност', почин: 'неисправност', исправ: 'неисправност', troubleshoot: 'неисправност',
  импорт: 'импорт', import: 'импорт', tlauncher: 'импорт', тлаунчер: 'импорт', multimc: 'импорт', prism: 'импорт', призм: 'импорт',
  статистик: 'статистик', наигран: 'статистик', наиграл: 'статистик', playtime: 'статистик', недел: 'статистик',
  язык: 'язык', языки: 'язык', language: 'язык', english: 'язык', английск: 'язык', локализац: 'язык', русск: 'язык',
  github: 'github', гитхаб: 'github', исходник: 'github', исходн: 'github',
  рекомендац: 'рекомендац', рекоменд: 'рекомендац', совет: 'рекомендац', сколько: 'рекомендац'
};

/**
 * Фразы «своими словами» → понятие. Срабатывают на весь запрос до разбиения
 * на слова: «не запускается», «чёрный экран», «не хватает памяти».
 */
const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/не (запуска|открыва|включа|грузит|загружа|работа|заход)\S*/g, ' ошибк '],
  [/черн\S* экран|бел\S* экран|выкидывает|выбивает/g, ' ошибк '],
  [/не хвата\S* (памят|озу|оперативк)\S*|мало (памят|озу|оперативк)\S*|out ?of ?memory|java heap/g, ' памят '],
  [/сколько (гб|гигабайт|памят|озу|оперативк)\S*/g, ' памят рекомендац '],
  [/(сменить|поменять|поставить|свой|своего|другой) скин\S*/g, ' скин '],
  [/(живые|анимированн\S*|свои) обои|видео на фон\S*|свой фон|фоном/g, ' фон '],
  [/из (другого|старого|прошлого) лаунчера|перенести сборк\S*/g, ' импорт '],
  [/(между|в друг\S*) сборк\S*/g, ' перенос мод '],
  [/время в игре|сколько (я )?(играл|наиграл)\S*/g, ' статистик '],
  [/удалить лаунчер|снести лаунчер/g, ' удал '],
  [/без лицензи\S*|пиратск\S*/g, ' офлайн ely '],
  [/(играть|поиграть|вместе) с (друг\S*|друзь\S*|подруг\S*)/g, ' lan сервер '],
  [/с (другом|друзьями|подругой)/g, ' lan ']
];

/** Точки и плюсы в конце слов («модов.») мешают сравнению; внутри слова («ely.by») остаются. */
function cleanText(text: string): string {
  return normalizeText(text).replace(/[.+-]+(?=\s|$)/g, '');
}

function expandPhrases(text: string): string {
  let out = cleanText(text);
  for (const [re, concept] of PHRASE_SYNONYMS) out = out.replace(re, concept);
  return out;
}

const SYNONYM_KEYS = Object.keys(SYNONYMS).filter((k) => k.length >= 4);
// Длинные основы первыми, чтобы «оптимизац» не перехватила более короткая
const SYNONYM_PREFIX = [...SYNONYM_KEYS].filter((k) => k.length >= 5).sort((a, b) => b.length - a.length);

const canonicalCache = new Map<string, string>();
function canonical(word: string): string {
  let hit = canonicalCache.get(word);
  if (hit === undefined) {
    hit = canonicalRaw(word);
    canonicalCache.set(word, hit);
  }
  return hit;
}

function canonicalRaw(word: string): string {
  const base = stem(word);
  const exact = SYNONYMS[word] ?? SYNONYMS[base];
  if (exact) return exact;
  // Начало слова: «находится» → «наход…», «оптимизировать» → «оптимизац»
  const prefix = SYNONYM_PREFIX.find((key) => base.startsWith(key));
  if (prefix) return SYNONYMS[prefix];
  // Опечатка в самом слове: «обнавить» → «обнов…» → обновление
  if (base.length >= 4) {
    for (const key of SYNONYM_KEYS) {
      if (Math.abs(key.length - base.length) <= 1 && editDistance(base, key, 1) <= 1) return SYNONYMS[key];
    }
  }
  return base;
}

/**
 * Понятия для недописанного слова: «оптим» → «тормоз» (из «оптимизац»),
 * «скри» → «снимк». Пользователь ещё печатает — подходят все синонимы,
 * которые начинаются так же (и с одной опечаткой для длинных начал).
 */
const partialCache = new Map<string, string[]>();
function partialConcepts(word: string): string[] {
  let hit = partialCache.get(word);
  if (!hit) {
    hit = partialRaw(word);
    partialCache.set(word, hit);
  }
  return hit;
}

function partialRaw(word: string): string[] {
  const w = word.replace(/ё/g, 'е');
  if (w.length < 3) return [];
  const out = new Set<string>();
  for (const key of Object.keys(SYNONYMS)) {
    if (key.length <= w.length) continue;
    if (key.startsWith(w) || (w.length >= 5 && editDistance(key.slice(0, w.length), w, 1) <= 1)) out.add(SYNONYMS[key]);
  }
  return [...out];
}

export function tokens(text: string): string[] {
  return cleanText(text)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(canonical);
}

/**
 * Слова запроса с вариантами: каждое — основная форма и понятия, если слово
 * не дописано. Последнее слово считается недописанным, пока после него нет пробела.
 */
function queryWords(query: string): string[][] {
  const raw = expandPhrases(query)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const typing = !/\s$/.test(query);
  const seen = new Set<string>();
  const out: string[][] = [];
  raw.forEach((w, i) => {
    const main = canonical(w);
    const isLast = i === raw.length - 1 && typing;
    const alts = [...new Set([main, ...(isLast || w.length >= 4 ? partialConcepts(w) : [])])];
    const key = alts.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(alts);
  });
  return out;
}

interface IndexedGuide {
  guide: Guide;
  title: string[];
  keys: string[];
  summary: string[];
  body: string[];
  titleText: string;
}

/**
 * Текст гайда для поиска. В гайде о самом поиске примеры запросов в кавычках
 * («сколко памити», «ьщвы») не индексируем — иначе он находился бы вместо нужного.
 */
function bodyText(guide: Guide): string {
  const text = guide.sections.map((s) => `${s.heading} ${s.text ?? ''} ${(s.steps ?? []).join(' ')} ${s.note ?? ''}`).join(' ');
  return guide.id === 'launcher-search' ? text.replace(/«[^»]*»/g, ' ') : text;
}

let index: IndexedGuide[] | null = null;
function indexed(): IndexedGuide[] {
  index ??= GUIDES.map((guide) => ({
    guide,
    title: tokens(guide.title),
    keys: tokens(guide.keywords.join(' ')),
    summary: tokens(guide.summary),
    body: tokens(bodyText(guide)),
    titleText: normalizeText(guide.title)
  }));
  return index;
}

/** Лучшее совпадение слова (с вариантами) со словами поля: точно, начало, опечатка. */
function best(word: string | string[], field: string[]): number {
  const alts = Array.isArray(word) ? word : [word];
  let top = 0;
  for (const alt of alts) {
    for (const w of field) {
      const m = wordMatch(alt, w);
      if (m > top) top = m;
      if (top === 1) return 1;
    }
  }
  return top;
}

function scoreGuides(query: string): { guide: Guide; score: number; matched: number; total: number }[] {
  const words = queryWords(query);
  const phrase = normalizeText(query);
  return indexed().map((g) => {
    let score = 0;
    let matched = 0;
    for (const word of words) {
      const hit = best(word, g.title) * 10 + best(word, g.keys) * 7 + best(word, g.summary) * 4 + best(word, g.body) * 2;
      if (hit > 0) matched++;
      score += hit;
    }
    if (phrase.length > 4 && g.titleText.includes(phrase)) score += 14;
    return { guide: g.guide, score, matched, total: words.length };
  });
}

function pick(scored: ReturnType<typeof scoreGuides>, limit: number): { list: Guide[]; quality: number } {
  const total = scored[0]?.total ?? 0;
  if (!total) return { list: [], quality: 0 };
  const strong = scored.filter((s) => s.matched === total && s.score > 0);
  const pool = strong.length ? strong : scored.filter((s) => s.matched >= Math.max(1, Math.ceil(total * 0.5)) && s.score > 0);
  const list = pool.sort((a, b) => b.score - a.score).slice(0, limit);
  return { list: list.map((s) => s.guide), quality: (list[0]?.score ?? 0) * (strong.length ? 2 : 1) };
}

/**
 * Поиск по гайдам: синонимы и фразы своими словами («лагает», «не запускается»,
 * «куда кидать моды»), недописанные слова, опечатки, чужая раскладка («ьщвы» →
 * «моды») и транслит («mody», «pamyat»).
 */
export function searchGuides(query: string, limit = 6): Guide[] {
  if (!queryWords(query).length) return GUIDES.slice(0, limit);
  const [first, ...others] = queryVariants(query);
  let bestPick = pick(scoreGuides(first), limit);
  for (const variant of others) {
    const alt = pick(scoreGuides(variant), limit);
    // Другой вариант берём, только если он заметно лучше исходного запроса
    if (alt.quality > bestPick.quality * 1.5) bestPick = alt;
  }
  return bestPick.list;
}

/** Совпадает ли запрос с текстом (для настроек и сборок): все слова, с опечатками, раскладкой и транслитом. */
export function fuzzyMatch(query: string, text: string): boolean {
  const target = [...tokens(text), ...normalizeText(text).split(/\s+/).filter(Boolean)];
  const check = (q: string) => {
    const words = queryWords(q);
    return words.length > 0 && words.every((w) => best(w, target) > 0);
  };
  return queryVariants(query).some(check);
}

/* ---------------------------- Подсказки при вводе ---------------------------- */

export { COMMON_QUERIES };

export interface SearchSuggestion {
  text: string;
  kind: 'query' | 'guide' | 'setting' | 'instance' | 'mod';
}

const POPULAR_MODS = [
  'Sodium', 'Iris Shaders', 'Lithium', 'Fabric API', 'Mod Menu', 'JEI', 'EMI', "Xaero's Minimap", 'JourneyMap', 'Create',
  'FerriteCore', 'ModernFix', 'Entity Culling', 'ImmediatelyFast', 'AppleSkin', 'Jade', 'Waystones', 'Distant Horizons',
  'Simple Voice Chat', 'Mouse Tweaks', 'Zoomify', '3D Skin Layers', 'Continuity', "Farmer's Delight", 'Terralith',
  "Biomes O' Plenty", "Alex's Mobs", 'Twilight Forest', 'Better Combat', 'Epic Fight', "Iron's Spells", 'Supplementaries'
];

/** Насколько фраза подходит под недописанный запрос: 0 — не подходит. */
function suggestScore(query: string, phrase: string): number {
  const q = normalizeText(query);
  const p = normalizeText(phrase);
  if (!q || p === q) return 0;
  if (p.startsWith(q)) return 4;
  const qWords = q.split(' ');
  const pWords = p.split(' ');
  const last = qWords[qWords.length - 1];
  const head = qWords.slice(0, -1);
  // Уже дописанные слова должны встречаться во фразе (с опечаткой или синонимом)
  const headOk = head.every(
    (w) => w.length < 2 || STOP.has(w) || pWords.some((pw) => wordMatch(w, pw) > 0 || canonical(w) === canonical(pw))
  );
  if (!headOk) return 0;
  if (pWords.some((pw) => pw.startsWith(last))) return 3;
  const typos = Math.max(1, allowedTypos(last));
  if (last.length >= 3 && pWords.some((pw) => pw.length >= last.length && editDistance(pw.slice(0, last.length), last, typos) <= typos)) return 2;
  // Синоним: «оптим» → понятие «тормоз», а во фразе «лагает»
  const concepts = partialConcepts(last);
  if (concepts.length && pWords.some((pw) => concepts.includes(canonical(pw)))) return 1;
  return 0;
}

/**
 * Подсказки, пока пользователь печатает: частые вопросы, гайды, настройки,
 * сборки и популярные моды. Учитывает опечатки, раскладку и транслит.
 */
export function suggestQueries(
  query: string,
  extra: SearchSuggestion[] = [],
  limit = 6
): SearchSuggestion[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const pool: SearchSuggestion[] = [
    ...COMMON_QUERIES.map((text) => ({ text, kind: 'query' as const })),
    ...GUIDES.map((g) => ({ text: g.title, kind: 'guide' as const })),
    ...SETTINGS_LINKS.map((s) => ({ text: s.title, kind: 'setting' as const })),
    ...extra,
    ...POPULAR_MODS.map((text) => ({ text, kind: 'mod' as const }))
  ];
  const variants = queryVariants(q);
  const scored: { s: SearchSuggestion; score: number }[] = [];
  for (const s of pool) {
    let score = 0;
    variants.forEach((v, i) => {
      // Исходный запрос чуть важнее раскладки и транслита
      score = Math.max(score, suggestScore(v, s.text) - (i ? 0.5 : 0));
    });
    if (score > 0) scored.push({ s, score });
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score || a.s.text.length - b.s.text.length)
    .filter(({ s }) => {
      const k = normalizeText(s.text);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit)
    .map(({ s }) => s);
}

/** Короткие ссылки на разделы настроек для поиска. */
export const SETTINGS_LINKS = [
  { id: 'general', title: 'Общие настройки', hint: 'язык, папка данных, память по умолчанию', hash: '/settings?tab=general' },
  { id: 'accounts', title: 'Аккаунты', hint: 'Microsoft, Ely.by и офлайн-профили', hash: '/settings?tab=accounts' },
  { id: 'appearance', title: 'Внешний вид', hint: 'темы, акценты, свой фон: картинка или видео, шрифты', hash: '/settings?tab=appearance' },
  { id: 'language', title: 'Язык интерфейса', hint: '13 языков и перевод страниц модов', hash: '/settings?tab=language' },
  { id: 'java', title: 'Java и память', hint: 'версии Java, аргументы JVM', hash: '/settings?tab=java' },
  { id: 'ai', title: 'ИИ-помощник', hint: 'ключ API и объяснение ошибок', hash: '/settings?tab=ai' },
  { id: 'downloads', title: 'Загрузки и папка данных', hint: 'куда скачивать, скорость, потоки', hash: '/settings?tab=downloads' },
  { id: 'onboarding', title: 'Обучение', hint: 'запустить тур заново', hash: '/settings?tab=onboarding' },
  { id: 'controls', title: 'Настройки управления', hint: 'клавиши, дубликаты и сброс', hash: '/controls' },
  { id: 'about', title: 'О лаунчере', hint: 'обновления, GitHub, удаление и лицензии', hash: '/settings?tab=about' },
  { id: 'translate', title: 'Перевод страниц модов', hint: 'MyMemory, лимит, ИИ', hash: '/settings?tab=ai' }
];
/**
 * Время чтения для показа. В гайдах записано время «с запасом», а читают их
 * примерно вдвое быстрее — показываем половину, но не меньше минуты.
 */
export function readMinutes(guide: Pick<Guide, 'minutes'>): number {
  return Math.max(1, Math.round(guide.minutes / 2));
}
