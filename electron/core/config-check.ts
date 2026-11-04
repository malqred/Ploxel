// Быстрая проверка файла настроек перед сохранением. Ловит явные ошибки
// (лишняя запятая в JSON, строка без «=» в TOML), чтобы игра не упала
// при запуске. Проверка осторожная: сомнительное не считается ошибкой.

/** Текст ошибки с номером строки или null, если явных ошибок нет. */
export function checkConfigText(fileName: string, text: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'json') return checkJson(text);
  if (ext === 'toml') return checkToml(text);
  return null;
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function checkJson(text: string): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Часть модов пишет в .json комментарии (JSON5) — это не ошибка для них
    if (/\/\/|\/\*/.test(text)) return null;
    const pos = /position (\d+)/.exec(message);
    const where = pos ? `строка ${lineOf(text, Number(pos[1]))}` : 'место не определено';
    return `ошибка JSON (${where}): ${message}`;
  }
}

/** Убирает комментарий «#» вне строк. */
function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function checkToml(text: string): string | null {
  const lines = text.split(/\r?\n/);
  let depth = 0; // незакрытые [ и { в значении, которое продолжается на следующих строках
  let multiline: string | null = null; // незакрытая """ или '''
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (multiline) {
      const end = line.indexOf(multiline);
      if (end < 0) continue;
      line = line.slice(end + 3);
      multiline = null;
    }
    const body = stripTomlComment(line).trim();
    if (!body) continue;
    if (depth === 0) {
      if (/^\[\[?[^\]]+\]\]?$/.test(body)) continue;
      if (!body.includes('=')) return `строка ${i + 1}: ожидалось «ключ = значение» или [раздел]`;
    }
    const triple = /"""|'''/.exec(body);
    if (triple && body.split(triple[0]).length % 2 === 0) {
      multiline = triple[0];
      continue;
    }
    for (const ch of body.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '')) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
    }
    if (depth < 0) return `строка ${i + 1}: лишняя закрывающая скобка`;
  }
  if (multiline) return `не закрыта многострочная строка ${multiline}`;
  if (depth > 0) return 'не закрыта скобка [ или { в конце файла';
  return null;
}
