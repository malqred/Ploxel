// HTML из лент Mojang (заметки к обновлениям) → markdown для компонента Markdown.
// Разметка там простая, но теги <p> и <li> часто не закрыты, поэтому разбираем
// поток тегов, а не дерево. Неизвестные теги отбрасываются, скрипты — целиком.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToMarkdown(html: string): string {
  const clean = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  let out = '';
  let depth = 0;
  const links: string[] = [];
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  for (const m of clean.matchAll(re)) {
    if (m[4] !== undefined) {
      // Переносы внутри HTML — просто пробелы
      out += decode(m[4]).replace(/\s*\n\s*/g, ' ');
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    switch (tag) {
      case 'p':
      case 'div':
        out += '\n\n';
        break;
      case 'br':
        out += '\n';
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        out += closing ? '\n\n' : `\n\n${'#'.repeat(Math.min(Number(tag[1]), 4))} `;
        break;
      case 'ul':
      case 'ol':
        // Перенос — только вокруг списка верхнего уровня, вложенный идёт следом за пунктом
        if (!closing && depth === 0) out += '\n';
        depth = Math.max(0, depth + (closing ? -1 : 1));
        if (closing && depth === 0) out += '\n';
        break;
      case 'li':
        if (!closing) out += `\n${'  '.repeat(Math.max(0, depth - 1))}- `;
        break;
      case 'code':
        out += '`';
        break;
      case 'em':
      case 'i':
        out += '*';
        break;
      case 'strong':
      case 'b':
        out += '**';
        break;
      case 'a': {
        if (closing) {
          const href = links.pop();
          out += href ? `](${href})` : '';
        } else {
          const href = m[3].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
          const safe = href && /^https?:\/\//i.test(href) ? href : '';
          links.push(safe);
          if (safe) out += '[';
        }
        break;
      }
      default:
        break;
    }
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+$/, '').replace(/^(\s*-) +/, '$1 '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(\s*- )\s+/gm, '$1')
    .trim();
}
