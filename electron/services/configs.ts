// Редактор конфигов: текстовые файлы настроек модов в папке сборки.
// Открываются только папки config, defaultconfigs, kubejs/config и options.txt —
// ни модов, ни миров редактор не трогает. Перед сохранением прошлая версия
// копируется в backups/configs/<дата>/.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { instanceDir } from './paths';
import { checkConfigText } from '../core/config-check';
import type { ConfigFileInfo } from '../../shared/types';

/** Где лежат настройки модов (пути от папки сборки). */
const ROOTS = ['config', 'defaultconfigs', 'kubejs/config'];
const ROOT_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt'];
const TEXT_EXT = new Set(['.json', '.json5', '.toml', '.properties', '.cfg', '.conf', '.txt', '.yml', '.yaml', '.snbt', '.ini', '.jsonc']);
/** Больше — не настройки, а данные; редактор в окне с ними не справится */
export const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_FILES = 5000;

function isEditable(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  if (ROOT_FILES.includes(norm)) return true;
  if (!ROOTS.some((r) => norm.startsWith(r + '/'))) return false;
  return TEXT_EXT.has(path.extname(norm).toLowerCase());
}

/** Абсолютный путь файла настроек; всё вне разрешённых папок — ошибка. */
export function resolveConfig(instanceId: string, rel: string): string {
  const root = path.resolve(instanceDir(instanceId));
  const full = path.resolve(root, rel);
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !isEditable(relative)) {
    throw new Error('Этот файл нельзя открыть в редакторе настроек');
  }
  return full;
}

export function listConfigFiles(instanceId: string): ConfigFileInfo[] {
  const root = instanceDir(instanceId);
  const out: ConfigFileInfo[] = [];
  const push = (full: string) => {
    const st = fs.statSync(full);
    out.push({
      path: path.relative(root, full).replace(/\\/g, '/'),
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString()
    });
  };
  for (const name of ROOT_FILES) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) push(full);
  }
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || out.length >= MAX_FILES || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && isEditable(path.relative(root, full))) push(full);
      if (out.length >= MAX_FILES) return;
    }
  };
  for (const r of ROOTS) walk(path.join(root, r), 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readConfigFile(instanceId: string, rel: string): Promise<{ text: string; modifiedAt: string }> {
  const full = resolveConfig(instanceId, rel);
  const st = await fsp.stat(full);
  if (st.size > MAX_CONFIG_BYTES) throw new Error('Файл больше 1 МБ — откройте его в обычном редакторе через папку сборки.');
  const buf = await fsp.readFile(full);
  if (buf.includes(0)) throw new Error('Это не текстовый файл.');
  return { text: buf.toString('utf8').replace(/^﻿/, ''), modifiedAt: st.mtime.toISOString() };
}

/**
 * Сохраняет файл. expectedModifiedAt — время изменения, с которым файл открыли:
 * если игра или мод успели переписать файл, сохранение не затрёт их правку молча.
 */
export async function writeConfigFile(
  instanceId: string,
  rel: string,
  text: string,
  expectedModifiedAt?: string,
  force = false
): Promise<{ modifiedAt?: string; problem?: string }> {
  const full = resolveConfig(instanceId, rel);
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) throw new Error('Текст больше 1 МБ.');
  const problem = checkConfigText(rel, text);
  // Ошибка формата — не исключение: окно покажет её и предложит «Сохранить всё равно»
  if (problem && !force) return { problem };
  if (fs.existsSync(full)) {
    const st = await fsp.stat(full);
    if (!force && expectedModifiedAt && st.mtime.toISOString() !== expectedModifiedAt) {
      throw new Error('Файл изменился, пока был открыт (его могла переписать игра). Откройте его заново.');
    }
    const day = new Date().toISOString().slice(0, 10);
    const backup = path.join(instanceDir(instanceId), 'backups', 'configs', day, rel);
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    await fsp.copyFile(full, backup);
  }
  await fsp.writeFile(full, text, 'utf8');
  return { modifiedAt: (await fsp.stat(full)).mtime.toISOString() };
}
