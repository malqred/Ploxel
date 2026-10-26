// Поиск перевода строки интерфейса в словаре: точное совпадение, затем без
// обрамляющей пунктуации, затем шаблоны с местами для вставок ({0}) и, наконец,
// пословно для коротких строк с числами («Моды · 0»).

export type Lookup = (core: string) => string | null;

const CYRILLIC = /[А-Яа-яЁё]/;

export function createTranslator(dict: Record<string, string>): Lookup {
  // Слова из однословных ключей: помогает переводить «Моды · 0», «17 материалов».
  const words = new Map<string, string>();
  for (const [key, value] of Object.entries(dict)) {
    if (key.includes(' ') || key.length < 3) continue;
    words.set(key.toLowerCase(), value);
  }
  const translateWords = (core: string): string | null => {
    if (!/[0-9·]/.test(core)) return null;
    // Не трогаем строки с именами, кавычками и латиницей (ники, версии, названия).
    if (/[«»"'A-Za-z]/.test(core)) return null;
    const parts = core.split(/(\p{L}+)/u);
    let any = false;
    for (const part of parts) {
      if (!/^\p{L}+$/u.test(part)) continue;
      if (!words.has(part.toLowerCase())) return null;
      any = true;
    }
    if (!any) return null;
    return parts
      .map((part) => {
        if (!/^\p{L}+$/u.test(part)) return part;
        const tr = words.get(part.toLowerCase())!;
        if (part === part.toUpperCase()) return tr.toUpperCase();
        if (/^[A-ZА-ЯЁ]/.test(part)) return tr.charAt(0).toUpperCase() + tr.slice(1);
        return tr;
      })
      .join('');
  };
  // Ключи с местами для вставок: «Обновлено: {0}» → регулярное выражение.
  // Якорь — самый длинный кусок текста шаблона: по нему быстро отсекаем лишние.
  const patterns: { re: RegExp; anchor: string; value: string }[] = [];
  for (const [key, value] of Object.entries(dict)) {
    if (!/\{\d\}/.test(key) || value === key) continue;
    const pieces = key.split(/\{\d\}/);
    const anchor = pieces.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (anchor.trim().length < 2) continue;
    const source = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d)\\?\}/g, '(?<g$1>[\\s\\S]+?)');
    patterns.push({ re: new RegExp(`^${source}$`), anchor, value });
  }
  patterns.sort((a, b) => b.anchor.length - a.anchor.length);

  const exactOnly = (s: string): string | null => {
    const v = dict[s];
    return v && v !== s ? v : null;
  };
  /** Перевод вставки: пробелы по краям сохраняем; null — вставка осталась русской. */
  const translatePart = (part: string): string | null => {
    const [, lead, mid, trail] = part.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    // Вставка короче всей строки, поэтому рекурсия конечна
    const tr = lookup(mid) ?? exactOnly(mid.charAt(0).toUpperCase() + mid.slice(1))?.toLowerCase() ?? null;
    if (tr) return lead + tr + trail;
    return CYRILLIC.test(mid) ? null : part;
  };
  const byPattern = (core: string): string | null => {
    next: for (const p of patterns) {
      if (!core.includes(p.anchor)) continue;
      const m = p.re.exec(core);
      if (!m?.groups) continue;
      // Вставки (числа, названия) переносим как есть; если вставка — сама строка
      // интерфейса («моды»), переводим и её. Если во вставке остался русский
      // текст — шаблон захватил лишнее («{0} ГБ» внутри длинной фразы), ищем дальше.
      const parts: Record<string, string> = {};
      for (const [name, part] of Object.entries(m.groups)) {
        const tr = translatePart(part ?? '');
        if (tr === null) continue next;
        parts[name] = tr;
      }
      return p.value.replace(/\{(\d)\}/g, (_, i: string) => parts[`g${i}`] ?? '');
    }
    return null;
  };
  const lookup = (core: string): string | null => {
    const exact = exactOnly(core);
    if (exact) return exact;
    const whole = byPattern(core);
    if (whole) return whole;
    // «· пауза», «Скорость:», «(по данным Mojang)» — переводим середину, обрамление оставляем
    const affix = core.match(/^([^\p{L}\d{«"]*)([\s\S]*?)([^\p{L}\d}»")]*)$/u);
    if (affix && (affix[1] || affix[3]) && affix[2]) {
      const mid = exactOnly(affix[2]) ?? byPattern(affix[2]);
      if (mid) return affix[1] + mid + affix[3];
    }
    return translateWords(core);
  };
  return lookup;
}
