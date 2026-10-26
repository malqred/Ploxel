import { BASIC_GUIDES } from './basic';
import { ADVANCED_GUIDES } from './advanced';
import { EXTRA_GUIDES } from './extra';
import { CURRENT_GUIDES } from './current';
import type { Guide } from './types';
import { editDistance, normalizeText, switchLayout, wordMatch } from '../../../shared/search';

export const GUIDES: Guide[] = [...BASIC_GUIDES, ...ADVANCED_GUIDES, ...EXTRA_GUIDES, ...CURRENT_GUIDES];
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
  добав: 'установ', install: 'установ', загруз: 'установ',
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
  lan: 'lan', сет: 'lan', локалк: 'lan', локальн: 'lan', друг: 'lan', друзья: 'lan', друзьям: 'lan', вместе: 'lan',
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
  перенос: 'перенос', перенес: 'перенос', хранилищ: 'перенос', storage: 'перенос',
  диск: 'перенос', место: 'перенос', места: 'перенос', освобод: 'перенос'
};

const SYNONYM_KEYS = Object.keys(SYNONYMS).filter((k) => k.length >= 4);
// Длинные основы первыми, чтобы «оптимизац» не перехватила более короткая
const SYNONYM_PREFIX = [...SYNONYM_KEYS].filter((k) => k.length >= 5).sort((a, b) => b.length - a.length);

function canonical(word: string): string {
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

export function tokens(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(canonical);
}

interface IndexedGuide {
  guide: Guide;
  title: string[];
  keys: string[];
  summary: string[];
  body: string[];
  titleText: string;
}

let index: IndexedGuide[] | null = null;
function indexed(): IndexedGuide[] {
  index ??= GUIDES.map((guide) => ({
    guide,
    title: tokens(guide.title),
    keys: tokens(guide.keywords.join(' ')),
    summary: tokens(guide.summary),
    body: tokens(
      guide.sections.map((s) => `${s.heading} ${s.text ?? ''} ${(s.steps ?? []).join(' ')} ${s.note ?? ''}`).join(' ')
    ),
    titleText: normalizeText(guide.title)
  }));
  return index;
}

/** Лучшее совпадение слова запроса со словами поля (точно, начало, опечатка). */
function best(word: string, field: string[]): number {
  let top = 0;
  for (const w of field) {
    const m = wordMatch(word, w);
    if (m > top) top = m;
    if (top === 1) break;
  }
  return top;
}

function scoreGuides(query: string): { guide: Guide; score: number; matched: number; total: number }[] {
  const words = [...new Set(tokens(query))];
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
 * Поиск по гайдам: синонимы и разговорные слова («лагает», «вылетает»,
 * «куда кидать моды»), опечатки и запрос в чужой раскладке («ьщвы» → «моды»).
 */
export function searchGuides(query: string, limit = 6): Guide[] {
  if (!tokens(query).length) return GUIDES.slice(0, limit);
  const direct = pick(scoreGuides(query), limit);
  const switched = pick(scoreGuides(switchLayout(query)), limit);
  return switched.quality > direct.quality * 1.5 ? switched.list : direct.list;
}

/** Совпадает ли запрос с текстом (для настроек и сборок): все слова, с опечатками и раскладкой. */
export function fuzzyMatch(query: string, text: string): boolean {
  const target = tokens(text);
  const check = (q: string) => {
    const words = tokens(q);
    return words.length > 0 && words.every((w) => best(w, target) > 0);
  };
  return check(query) || check(switchLayout(query));
}

/** Короткие ссылки на разделы настроек для поиска. */
export const SETTINGS_LINKS = [
  { id: 'general', title: 'Общие настройки', hint: 'язык, папка данных, память по умолчанию', hash: '/settings?tab=general' },
  { id: 'accounts', title: 'Аккаунты', hint: 'Microsoft и офлайн-профили', hash: '/settings?tab=accounts' },
  { id: 'appearance', title: 'Внешний вид', hint: 'темы, акценты, фоны, шрифты', hash: '/settings?tab=appearance' },
  { id: 'language', title: 'Язык интерфейса', hint: '13 языков и перевод страниц модов', hash: '/settings?tab=language' },
  { id: 'java', title: 'Java и память', hint: 'версии Java, аргументы JVM', hash: '/settings?tab=java' },
  { id: 'ai', title: 'ИИ-помощник', hint: 'ключ API и объяснение ошибок', hash: '/settings?tab=ai' },
  { id: 'downloads', title: 'Загрузки и папка данных', hint: 'куда скачивать, скорость, потоки', hash: '/settings?tab=downloads' },
  { id: 'onboarding', title: 'Обучение', hint: 'запустить тур заново', hash: '/settings?tab=onboarding' },
  { id: 'controls', title: 'Настройки управления', hint: 'клавиши, дубликаты и сброс', hash: '/controls' },
  { id: 'about', title: 'О лаунчере', hint: 'обновления, удаление и лицензии', hash: '/settings?tab=about' },
  { id: 'translate', title: 'Перевод страниц модов', hint: 'MyMemory, лимит, ИИ', hash: '/settings?tab=ai' }
];