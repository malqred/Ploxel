import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Собирает русские строки интерфейса для словарей перевода (scripts/ui-strings.json).
// Шаблонные строки превращаются в ключи с местами для вставок:
//   `Обновлено: ${n}` → «Обновлено: {0}»
// Слой перевода (src/ui/LocalizationLayer.tsx) сопоставляет такие ключи с текстом на экране.

const ROOTS = ['src', 'electron', 'shared'];
const CYR = /[А-Яа-яЁё]/;
// Синонимы и ключевые слова поиска на экран не выводятся
const SKIP_FILES = [path.join('content', 'guides', 'index.ts'), path.join('shared', 'search.ts'), 'locales', path.join('electron', 'dev'), path.join('electron', 'main.ts')];
const SKIP_PROPS = new Set(['keywords', 'synonyms', 'aliases']);

const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(tsx?)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(full);
  }
}
for (const root of ROOTS) walk(root);

const set = new Set();
const add = (s, max) => {
  const v = s.replace(/\s+/g, ' ').trim();
  if (v.length > 1 && v.length <= max && CYR.test(v)) set.add(v);
};

/** Вызов console.*, логгера или регулярное выражение — не интерфейс. */
function insideIgnored(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      if (/^console\.|^log\(|appendLog|\.warn$|\.debug$/.test(callee)) return true;
    }
    if (ts.isPropertyAssignment(p) && SKIP_PROPS.has(p.name.getText())) return true;
    if (ts.isImportDeclaration(p)) return true;
  }
  return false;
}

for (const file of files) {
  if (SKIP_FILES.some((s) => file.includes(s))) continue;
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const maxLen = file.includes(path.join('content', 'guides')) ? Infinity : 400;
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CYR.test(node.text) && !insideIgnored(node)) add(node.text, maxLen);
    } else if (ts.isTemplateExpression(node)) {
      if (!insideIgnored(node)) {
        let s = node.head.text;
        node.templateSpans.forEach((span, i) => {
          s += `{${i}}` + span.literal.text;
        });
        // Шаблон из одних вставок без русского текста не нужен
        if (CYR.test(s.replace(/\{\d\}/g, ''))) add(s, maxLen);
      }
    } else if (ts.isJsxText(node)) {
      add(node.text, maxLen);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Тексты из JSON-ресурсов (правила разбора падений и т.п.) — только поля, видимые пользователю
const JSON_SOURCES = [path.join('electron', 'services', 'crash-rules.json')];
const JSON_FIELDS = new Set(['title', 'explanation', 'change', 'risks', 'label', 'text', 'hint']);
for (const file of JSON_SOURCES) {
  const walkJson = (v, key) => {
    if (typeof v === 'string') {
      if (JSON_FIELDS.has(key)) add(v, 400);
    } else if (Array.isArray(v)) v.forEach((x) => walkJson(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkJson(x, k);
  };
  walkJson(JSON.parse(fs.readFileSync(file, 'utf8')), '');
}

const list = [...set].sort((a, b) => a.localeCompare(b, 'ru'));
fs.writeFileSync('scripts/ui-strings.json', JSON.stringify(list, null, 1), 'utf8');
console.log('строк:', list.length, 'шаблонов:', list.filter((s) => /\{\d\}/.test(s)).length, 'символов:', list.reduce((n, s) => n + s.length, 0));
