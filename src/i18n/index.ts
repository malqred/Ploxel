import ru from './ru.json';
import en from './en.json';

type Dict = Record<string, string>;
const dictionaries: Record<string, Dict> = { ru: ru as Dict, en: en as Dict };

/** Язык интерфейса → локаль для чисел, дат и единиц. */
const LOCALES: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pl: 'pl-PL',
  sv: 'sv-SE',
  fi: 'fi-FI',
  uk: 'uk-UA',
  ko: 'ko-KR',
  ja: 'ja-JP',
  zh: 'zh-CN'
};

let current = 'ru';

export function setLanguage(lang: string) {
  current = LOCALES[lang] ? lang : 'ru';
  document.documentElement.lang = current;
}

export function getLanguage() {
  return current;
}

function locale(): string {
  return LOCALES[current] ?? 'ru-RU';
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[current] ?? dictionaries.ru;
  let value = dict[key] ?? dictionaries.ru[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) value = value.replaceAll(`{${k}}`, String(v));
  }
  return value;
}

/** Форматирование чисел и дат по языку интерфейса. */
export function fmtNumber(n: number): string {
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function fmtTime(iso: string | number | Date, seconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

export function fmtRelative(iso: string | number | Date): string {
  const d = new Date(iso).getTime();
  const min = Math.round((Date.now() - d) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'short' });
  if (min < 1) return rtf.format(0, 'second');
  if (min < 60) return rtf.format(-min, 'minute');
  const hours = Math.round(min / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return fmtDate(iso);
}

/** Единицы объёма: в русском и украинском — «КБ», во французском — «Ko», остальные — «KB». */
function byteUnits(): string[] {
  if (current === 'ru' || current === 'uk') return ['Б', 'КБ', 'МБ', 'ГБ'];
  if (current === 'fr') return ['o', 'Ko', 'Mo', 'Go'];
  return ['B', 'KB', 'MB', 'GB'];
}

export function fmtBytes(bytes: number): string {
  const units = byteUnits();
  if (!bytes) return `0 ${units[0]}`;
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = new Intl.NumberFormat(locale(), { maximumFractionDigits: i === 0 ? 0 : 1, minimumFractionDigits: i === 0 ? 0 : 1 }).format(
    bytes / 1024 ** i
  );
  return `${value} ${units[i]}`;
}

/** Скорость: «1,5 МБ/с», «1.5 MB/s». */
export function fmtSpeed(bytesPerSecond: number): string {
  const per = current === 'ru' || current === 'uk' ? '/с' : '/s';
  return fmtBytes(bytesPerSecond) + per;
}

/** Гигабайты для ползунков памяти: «4 ГБ», «4 GB», «4 Go». */
export function fmtGb(gb: number): string {
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(gb)} ${byteUnits()[3]}`;
}

function unit(value: number, name: 'hour' | 'minute' | 'second'): string {
  return new Intl.NumberFormat(locale(), { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
}

/** Время игры: «0 мин», «45 мин», «2 ч 15 мин» — на языке интерфейса. */
export function fmtPlaytime(minutes: number | undefined): string {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return unit(mins, 'minute');
  if (mins === 0) return unit(hours, 'hour');
  return `${unit(hours, 'hour')} ${unit(mins, 'minute')}`;
}

/** Оставшееся время: «40 с», «3 мин 20 с». */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return unit(s, 'second');
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m >= 60) return fmtPlaytime(m);
  return rest ? `${unit(m, 'minute')} ${unit(rest, 'second')}` : unit(m, 'minute');
}
