// Разбор падений по правилам (без ИИ).
// Правила лежат в crash-rules.json — данные, а не код: их можно править
// без пересборки логики. Из логов извлекаются имена модов/файлов/зависимостей
// именованными regex-группами (mod, file, dep, memory).

import fs from 'node:fs';
import path from 'node:path';
import rulesJson from './crash-rules.json';
import type { CrashAnalysis, CrashCause, CrashFix } from '../../shared/types';

export interface CrashRule {
  id: string;
  title: string;
  patterns: string[];
  negativePatterns?: string[];
  /** regex только для извлечения групп (не создают доказательство сами) */
  extractPatterns?: string[];
  explanation: string;
  change: string;
  risks: string;
  confidence: 'high' | 'medium' | 'low';
  fix?: CrashFix;
}

interface CompiledRule extends CrashRule {
  triggers: RegExp[];
  negatives: RegExp[];
  extractors: RegExp[];
  order: number;
}

export interface AnalyzeOptions {
  /** exit code процесса игры (если известен) */
  exitCode?: number | null;
  /** корень данных (instances/ лежит внутри); без него берётся getRoot() */
  root?: string;
}

interface Source {
  file: string;
  lines: string[];
}

interface Hit {
  rule: CompiledRule;
  file: string;
  lineNo: number;
  text: string;
  groups: Record<string, string>;
}

const MAX_CAUSES = 8;
const MAX_EVIDENCE = 3;
const EVIDENCE_LEN = 160;
const LOG_TAIL_LINES = 20;

let compiled: CompiledRule[] | null = null;

function loadRules(): CompiledRule[] {
  if (compiled) return compiled;
  const rules = rulesJson as unknown as CrashRule[];
  const out: CompiledRule[] = [];
  rules.forEach((rule, order) => {
    try {
      out.push({
        ...rule,
        order,
        triggers: rule.patterns.map((p) => new RegExp(p, 'i')),
        negatives: (rule.negativePatterns ?? []).map((p) => new RegExp(p, 'i')),
        extractors: (rule.extractPatterns ?? []).map((p) => new RegExp(p, 'gi'))
      });
    } catch (e) {
      console.warn(`[crash-analyzer] правило ${rule.id} пропущено (неверный regex): ${e}`);
    }
  });
  compiled = out;
  return out;
}

let rootOverride: string | null = null;

/** Переопределить корень данных (используется в тестах и при нестандартном root). */
export function setCrashDataRoot(root: string | null): void {
  rootOverride = root;
}

async function dataRoot(opts: AnalyzeOptions | undefined): Promise<string> {
  if (opts?.root) return opts.root;
  if (rootOverride) return rootOverride;
  try {
    const { getRoot } = await import('./paths');
    const r = getRoot();
    if (r) return r;
  } catch {
    /* вне Electron (тесты) — корень обязаны передать в opts */
  }
  return '';
}

function instancePath(root: string, id: string): string {
  return path.join(root, 'instances', id);
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/** Все доступные источники для сборки; отсутствующие файлы просто не попадают в список. */
function collectSources(dir: string): Source[] {
  const out: Source[] = [];
  const add = (file: string) => {
    try {
      if (fs.existsSync(file)) out.push({ file, lines: readLines(file) });
    } catch {
      /* файл мог исчезнуть */
    }
  };

  // свежий crash-репорт (по mtime, запасной вариант — имя: они датированы)
  const crashDir = path.join(dir, 'crash-reports');
  try {
    const txts = fs.readdirSync(crashDir).filter((f) => f.endsWith('.txt'));
    if (txts.length) {
      txts.sort((a, b) => {
        const ma = fs.statSync(path.join(crashDir, a)).mtimeMs;
        const mb = fs.statSync(path.join(crashDir, b)).mtimeMs;
        return mb - ma || b.localeCompare(a);
      });
      add(path.join(crashDir, txts[0]));
    }
  } catch {
    /* папки нет — ок */
  }

  add(path.join(dir, 'logs', 'latest.log'));
  add(path.join(dir, 'logs', 'ploxel-latest.log'));

  // hs_err_pid*.log JVM — прямо в папке сборки
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^hs_err_pid\d+\.log$/.test(f)) add(path.join(dir, f));
    }
  } catch {
    /* ок */
  }

  return out;
}

function pickGroups(m: RegExpExecArray): Record<string, string> {
  const out: Record<string, string> = {};
  if (m.groups) {
    for (const [k, v] of Object.entries(m.groups)) if (v != null) out[k] = v;
  }
  return out;
}

/** Найдены совпадения правил с группами извлечённых значений. */
function findHits(sources: Source[]): Hit[] {
  const hits: Hit[] = [];
  for (const src of sources) {
    const text = src.lines.join('\n');
    for (const rule of loadRules()) {
      // отрицательные паттерны смотрят на весь файл
      if (rule.negatives.some((re) => re.test(text))) continue;

      // группы из extractPatterns (например, -Xmx) — по всему файлу
      const extra: Record<string, string> = {};
      for (const re of rule.extractors) {
        for (const m of text.matchAll(re)) {
          for (const [k, v] of Object.entries(pickGroups(m))) if (!(k in extra)) extra[k] = v;
        }
      }
      if ('memoryBytes' in extra && !('memory' in extra)) {
        extra.memory = String(Math.round(Number(extra.memoryBytes) / 1048576));
        extra.memUnit = '';
      }

      for (let i = 0; i < src.lines.length; i++) {
        const raw = src.lines[i];
        if (!raw.trim()) continue;
        for (const re of rule.triggers) {
          const m = re.exec(raw);
          if (m) {
            hits.push({ rule, file: src.file, lineNo: i + 1, text: raw.trim(), groups: { ...extra, ...pickGroups(m) } });
            break; // одна строка — одно доказательство на правило
          }
        }
      }
    }
  }
  return hits;
}

function substitute(value: unknown, groups: Record<string, string>): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{(mod|file|dep|memory)\}\}/g, (_, g: string) => groups[g] ?? '');
}

export function recommendedMemoryMb(currentMb: number, unit: 'm' | 'g' = 'm'): number {
  const mb = unit === 'g' ? currentMb * 1024 : currentMb;
  if (!mb || mb <= 0) return 4096; // текущего значения не знаем — разумный минимум
  return Math.ceil((mb * 1.5) / 256) * 256;
}

function buildFix(rule: CompiledRule, groups: Record<string, string>): CrashFix | undefined {
  const base = rule.fix;
  if (!base) return undefined;
  const fix: CrashFix = { ...base };
  for (const k of Object.keys(fix)) fix[k] = substitute(fix[k], groups);

  if (fix.type === 'disable-mod') {
    const mod = typeof fix.mod === 'string' ? fix.mod.trim() : '';
    if (!mod) return undefined; // без имени мода отключать нечего
    fix.mod = mod;
  }
  if (fix.type === 'install-dependency' && typeof fix.dep === 'string' && !fix.dep.trim()) {
    delete fix.dep; // менеджер покажет список зависимостей без конкретного имени
  }
  if (typeof fix.file === 'string' && fix.file.length) {
    // из лога может прийти полный путь — для UI и менеджера достаточно имени
    const f = fix.file.replace(/\\/g, '/');
    fix.file = f.slice(f.lastIndexOf('/') + 1);
  }
  if (fix.type === 'increase-memory') {
    const raw = groups.memory;
    if (raw) {
      fix.memory = recommendedMemoryMb(Number(raw) || 0, (groups.memUnit ?? '').toLowerCase() === 'g' ? 'g' : 'm');
    } else {
      delete fix.memory; // при применении посчитаем из текущей memoryMb
    }
  }
  return fix;
}

const CONF_RANK: Record<CrashRule['confidence'], number> = { high: 0, medium: 1, low: 2 };

function buildCauses(hits: Hit[], exitCode: number | null): CrashCause[] {
  // дедупликация: одно правило = одна причина
  const byRule = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byRule.get(h.rule.id) ?? [];
    list.push(h);
    byRule.set(h.rule.id, list);
  }

  const entries = [...byRule.entries()].sort((a, b) => {
    const ra = CONF_RANK[a[1][0].rule.confidence];
    const rb = CONF_RANK[b[1][0].rule.confidence];
    return ra - rb || b[1].length - a[1].length || a[1][0].rule.order - b[1][0].rule.order;
  });

  const causes: CrashCause[] = [];
  for (const [, list] of entries) {
    if (causes.length >= MAX_CAUSES) break;
    const rule = list[0].rule;
    const groups: Record<string, string> = {};
    for (const h of list) {
      for (const [k, v] of Object.entries(h.groups)) if (!(k in groups)) groups[k] = v;
    }
    const seen = new Set<string>();
    const evidence: string[] = [];
    for (const h of list) {
      const clipped = h.text.length > EVIDENCE_LEN ? h.text.slice(0, EVIDENCE_LEN) + '…' : h.text;
      const ev = `${path.basename(h.file)}: ${h.lineNo}: ${clipped}`;
      if (!seen.has(ev)) {
        seen.add(ev);
        evidence.push(ev);
        if (evidence.length >= MAX_EVIDENCE) break;
      }
    }
    const fix = buildFix(rule, groups);
    const title = rule.title + (groups.mod ? `: ${groups.mod}` : '');
    causes.push({
      id: rule.id,
      title,
      explanation: rule.explanation,
      change: rule.change,
      risks: rule.risks,
      confidence: rule.confidence,
      evidence,
      ...(fix ? { fix } : {})
    });
  }

  if (causes.length === 0 && exitCode != null && exitCode !== 0) {
    causes.push({
      id: 'exit-code',
      title: `Процесс завершился с кодом ${exitCode}`,
      explanation:
        'В логах не найдено известных признаков падения. Код завершения говорит, что JVM/игра завершилась не штатно — смотрите хвост лога.',
      change: 'Проверить последние строки лога и повторить запуск.',
      risks: '—',
      confidence: 'low',
      evidence: [`exit code: ${exitCode}`]
    });
  }
  return causes;
}

function tail(lines: string[], n: number): string[] {
  const trimmed = lines.map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  return trimmed.slice(-n);
}

/**
 * Разбор падения сборки по правилам. Ничего не бросает, если файлов нет:
 * вернёт пустой список причин (или причину по exit code).
 */
export async function analyzeCrash(instanceId: string, opts: AnalyzeOptions = {}): Promise<CrashAnalysis> {
  const root = await dataRoot(opts);
  const dir = instancePath(root, instanceId);
  const sources = collectSources(dir);
  const causes = buildCauses(findHits(sources), opts.exitCode ?? null);
  const launcherLog =
    sources.find((s) => path.basename(s.file) === 'ploxel-latest.log') ??
    sources.find((s) => path.basename(s.file) === 'latest.log');
  return {
    causes,
    scannedFiles: sources.map((s) => s.file),
    logTail: launcherLog ? tail(launcherLog.lines, LOG_TAIL_LINES) : []
  };
}

/* --------------------------- Применение исправлений --------------------------- */

export type CrashFixStatus = 'applied' | 'requires-manager' | 'manual' | 'skipped';

export interface CrashFixResult {
  causeId: string;
  fixType?: string;
  status: CrashFixStatus;
  detail?: string;
  /** куда скопировано то, что менялось — для отката */
  backupPath?: string;
}

/**
 * Безопасные исправления по явным причинам (то, что передано в causes — и ничего
 * больше). Ничего не качает из сети: download-java / install-dependency /
 * redownload-files / switch-loader возвращаются как «требует менеджера».
 *
 * Перед каждым изменением файл копируется в <instance>/backups/crash/<timestamp>/
 * и путь возвращается в backupPath.
 */
export async function applyCrashFixes(
  instanceId: string,
  causes: CrashCause[],
  opts: AnalyzeOptions = {}
): Promise<CrashFixResult[]> {
  const root = await dataRoot(opts);
  const dir = instancePath(root, instanceId);
  if (!causes.length || !fs.existsSync(dir)) return [];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dir, 'backups', 'crash', stamp);
  const backup = (file: string): string | undefined => {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const dest = path.join(backupDir, path.basename(file));
      fs.copyFileSync(file, dest);
      return dest;
    } catch {
      return undefined;
    }
  };

  const results: CrashFixResult[] = [];
  for (const cause of causes) {
    const fix = cause.fix;
    if (!fix) {
      results.push({ causeId: cause.id, status: 'manual', detail: 'Требуется ручное действие' });
      continue;
    }

    switch (fix.type) {
      case 'disable-mod': {
        const mod = typeof fix.mod === 'string' ? fix.mod.trim() : '';
        if (!mod) {
          results.push({ causeId: cause.id, fixType: fix.type, status: 'skipped', detail: 'Не указано имя мода' });
          break;
        }
        const modsDir = path.join(dir, 'mods');
        let target: string | null = null;
        try {
          const files = fs.readdirSync(modsDir);
          target =
            files.find((f) => f.toLowerCase() === `${mod.toLowerCase()}.jar`) ??
            files.find((f) => /\.jar$/i.test(f) && f.toLowerCase().includes(mod.toLowerCase())) ??
            null;
        } catch {
          /* папки mods/ нет */
        }
        if (!target) {
          results.push({
            causeId: cause.id,
            fixType: fix.type,
            status: 'skipped',
            detail: `Файл мода «${mod}» не найден в mods/`
          });
          break;
        }
        const jar = path.join(modsDir, target);
        const disabled = `${jar}.disabled`;
        if (fs.existsSync(disabled)) {
          results.push({ causeId: cause.id, fixType: fix.type, status: 'skipped', detail: 'Мод уже отключён' });
          break;
        }
        const backupPath = backup(jar);
        fs.renameSync(jar, disabled);
        results.push({
          causeId: cause.id,
          fixType: fix.type,
          status: 'applied',
          detail: `${target} → ${target}.disabled`,
          backupPath
        });
        break;
      }

      case 'increase-memory': {
        const jsonFile = path.join(dir, 'instance.json');
        let inst: Record<string, unknown> | null = null;
        try {
          inst = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as Record<string, unknown>;
        } catch {
          inst = null;
        }
        if (!inst) {
          results.push({ causeId: cause.id, fixType: fix.type, status: 'skipped', detail: 'Не найдено instance.json' });
          break;
        }
        const current = typeof inst.memoryMb === 'number' ? inst.memoryMb : 2048;
        const value =
          typeof fix.memory === 'number' && fix.memory >= 256 ? fix.memory : recommendedMemoryMb(current);
        const backupPath = backup(jsonFile);
        inst.memoryMb = value;
        fs.writeFileSync(jsonFile, JSON.stringify(inst, null, 2), 'utf8');
        results.push({
          causeId: cause.id,
          fixType: fix.type,
          status: 'applied',
          detail: `memoryMb: ${current} → ${value}`,
          backupPath
        });
        break;
      }

      case 'download-java':
      case 'install-dependency':
      case 'redownload-files':
      case 'switch-loader':
        results.push({
          causeId: cause.id,
          fixType: fix.type,
          status: 'requires-manager',
          detail: 'Выполняется через соответствующий менеджер (сеты не выполняем)'
        });
        break;

      case 'open-mods-page':
        results.push({ causeId: cause.id, fixType: fix.type, status: 'manual', detail: 'Откройте вкладку «Моды»' });
        break;

      default:
        results.push({ causeId: cause.id, fixType: fix.type as string, status: 'skipped' });
    }
  }
  return results;
}

/**
 * Возвращает изменённые файлы из резервной копии, созданной applyCrashFixes.
 * Для модов убирает .disabled и кладёт исходный .jar обратно.
 */
export async function rollbackCrashBackup(
  instanceId: string,
  backupDir: string,
  opts: AnalyzeOptions = {}
): Promise<{ restored: string[]; warnings: string[] }> {
  const root = await dataRoot(opts);
  const dir = instancePath(root, instanceId);
  const restored: string[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(backupDir) || !fs.existsSync(dir)) {
    return { restored, warnings: ['Резервная копия не найдена'] };
  }
  for (const name of fs.readdirSync(backupDir)) {
    const from = path.join(backupDir, name);
    try {
      if (name.toLowerCase().endsWith('.jar')) {
        const target = path.join(dir, 'mods', name);
        fs.rmSync(`${target}.disabled`, { force: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(from, target);
        restored.push(target);
        continue;
      }
      const candidates = [path.join(dir, name), path.join(dir, 'mods', name), path.join(dir, 'config', name)];
      const target = candidates.find((c) => fs.existsSync(path.dirname(c)));
      if (target) {
        fs.copyFileSync(from, target);
        restored.push(target);
      } else {
        warnings.push(`Не удалось определить, куда вернуть ${name}`);
      }
    } catch (e) {
      warnings.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { restored, warnings };
}
