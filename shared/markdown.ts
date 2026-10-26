/**
 * Приведение описаний модов к простому markdown.
 * Описания на Modrinth/CurseForge часто смешивают markdown с HTML
 * (<center>, <img>, <br>, <a>), а бейджи оформлены картинками-ссылками.
 * Здесь HTML превращается в markdown, картинки убираются — показывать и
 * переводить остаётся только текст. Код внутри ``` не трогается.
 */
export function normalizeMarkdown(raw: string): string {
  const parts = raw.replace(/\r\n?/g, '\n').split(/(^```[^\n]*\n[\s\S]*?^```[^\n]*$)/m);
  const out = parts
    .map((part, idx) => (idx % 2 === 1 ? part : normalizeText(part)))
    .join('');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeText(text: string): string {
  let t = text;
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  // Бейджи: [![alt](img)](url) и одиночные картинки
  t = t.replace(/\[\s*!\[[^\]]*\]\([^)]*\)\s*\]\([^)]*\)/g, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/<img\b[^>]*>(\s*<\/img>)?/gi, '');
  t = t.replace(/<(video|iframe|picture|source|svg)\b[\s\S]*?(<\/\1>|\/>)/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
    const level = Math.min(4, Math.max(1, Number(lvl) - 0));
    return `\n\n${'#'.repeat(level)} ${collapse(inner)}\n\n`;
  });
  t = t.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = collapse(stripTags(inner));
    return label ? `[${label}](${href})` : '';
  });
  t = t.replace(/<\/?(b|strong)\b[^>]*>/gi, '**');
  t = t.replace(/<\/?(i|em)\b[^>]*>/gi, '_');
  t = t.replace(/<\/?(s|del|strike)\b[^>]*>/gi, '~~');
  t = t.replace(/<\/?code\b[^>]*>/gi, '`');
  t = t.replace(/<li\b[^>]*>/gi, '\n- ');
  t = t.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');
  t = t.replace(/<\/?(p|div|center|section|details|summary|ul|ol|li|table|tr|blockquote|span|font|sup|sub|u)\b[^>]*>/gi, (tag) =>
    /^<\/?(span|font|sup|sub|u)\b/i.test(tag) ? '' : '\n\n'
  );
  t = stripTags(t);
  t = decodeEntities(t);
  // Строки из одних пробелов — пустые; пустые ** и __ — убрать
  t = t
    .split('\n')
    .map((line) => (line.trim() ? line.replace(/\s+$/, '') : ''))
    .join('\n');
  t = t.replace(/\*\*\s*\*\*/g, '').replace(/(^|\s)__\s*__(?=\s|$)/g, '$1');
  // Отступы от HTML-разметки ломают списки и превращаются в код — убираем
  t = t.replace(/^[ \t]+(?=[^\s*+\d|>-])/gm, '');
  return t;
}

function stripTags(text: string): string {
  return text.replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, '');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}
