import React from 'react';
import { normalizeMarkdown } from '../../shared/markdown';

/**
 * Markdown для описаний модов: заголовки, списки, таблицы, ссылки,
 * жирный/курсив/код. Рендерит только React-элементы — без innerHTML.
 */
export function Markdown({ text }: { text: string }) {
  const lines = normalizeMarkdown(text).split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let code: string[] = [];
  let inCode = false;
  let i = 0;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="md-list">
        {list.map((item, idx) => (
          <li key={idx}>{inline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  const flushCode = () => {
    if (!code.length) return;
    blocks.push(
      <pre key={`code-${blocks.length}`} className="md-code">
        <code>{code.join('\n')}</code>
      </pre>
    );
    code = [];
  };

  const isTableSeparator = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      code.push(raw);
      i++;
      continue;
    }
    if (!line.trim()) {
      flushList();
      i++;
      continue;
    }

    // Таблица: строка с | и следующая строка-разделитель
    if (line.includes('|') && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      flushList();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div className="md-table-wrap" key={`table-${blocks.length}`}>
          <table className="md-table">
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th key={idx}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ridx) => (
                <tr key={ridx}>
                  {row.map((cell, cidx) => (
                    <td key={cidx}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s*_-]*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="md-hr" />);
      i++;
      continue;
    }

    if (/^#{1,4}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '');
      const Tag = (['h2', 'h3', 'h4', 'h5'][level - 1] ?? 'h5') as keyof React.JSX.IntrinsicElements;
      blocks.push(
        React.createElement(Tag, { key: `h-${blocks.length}`, className: `md-h md-h${level}` }, inline(content))
      );
      i++;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*+]\s+/, ''));
      i++;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      list.push(line.replace(/^\s*\d+\.\s+/, ''));
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      flushList();
      blocks.push(
        <blockquote key={`q-${blocks.length}`} className="md-quote">
          {inline(line.replace(/^>\s*/, ''))}
        </blockquote>
      );
      i++;
      continue;
    }

    flushList();
    // Склеиваем соседние строки в один абзац: markdown переносит строку
    // пробелом, а ссылки могут быть разорваны переносом.
    let para = line;
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!next.trim() || isSpecialLine(next) || isTableStart(lines, i + 1)) break;
      para += ` ${next.trim()}`;
      i++;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="md-p">
        {inline(para)}
      </p>
    );
    i++;
  }
  flushList();
  flushCode();
  return <div className="md">{blocks}</div>;
}

function isSpecialLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith('```') || t.startsWith('#') || t.startsWith('>')) return true;
  if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) return true;
  if (/^\s*([-*_])\s*\1\s*\1[\s*_-]*$/.test(t)) return true;
  return false;
}

function isTableStart(lines: string[], index: number): boolean {
  return !!lines[index]?.includes('|') && !!lines[index + 1]?.match(/^\s*\|?[\s:|-]+\|[\s:|-]*$/);
}

function splitRow(line: string): string[] {
  const parts = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return parts.map((p) => p.trim());
}

/** Инлайн-разметка: **жирный**, __жирный__, *курсив*, _курсив_, `код`, [ссылка](url). */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const regex =
    /(!\[[^\]]*\]\s*\([^)]+\)|\*\*\*[^*]+\*\*\*|___[^_]+___|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\[[^\]]*\]\s*\([^)]+\)|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('![')) {
      // Картинки не показываем — только текст описания.
      last = m.index + token.length;
      continue;
    }
    if (token.startsWith('***') || token.startsWith('___')) {
      out.push(
        <strong key={key++}>
          <em>{inline(token.slice(3, -3))}</em>
        </strong>
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key++}>{inline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('~~')) {
      out.push(<s key={key++}>{inline(token.slice(2, -2))}</s>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key++} className="md-inline">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const link = /\[([^\]]*)\]\s*\(([^)]+)\)/.exec(token);
      if (link && link[1].trim() && !link[1].startsWith('!')) {
        out.push(
          <button
            key={key++}
            className="md-link"
            onClick={() => window.ploxel.invoke('shell:openExternal', link[2].trim())}
          >
            {inline(link[1])}
          </button>
        );
      }
    } else {
      out.push(<em key={key++}>{inline(token.slice(1, -1))}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}