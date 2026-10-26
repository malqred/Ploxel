import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { instanceDir, p } from './paths';
import type { Instance, InstalledMod, LoaderSpec } from '../../shared/types';

const SUBDIRS = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves', 'logs', 'screenshots', 'crash-reports', 'backups'];

export function instanceJsonPath(id: string): string {
  return path.join(instanceDir(id), 'instance.json');
}

export function readInstance(id: string): Instance | null {
  try {
    return JSON.parse(fs.readFileSync(instanceJsonPath(id), 'utf8')) as Instance;
  } catch {
    return null;
  }
}

export function listInstances(): Instance[] {
  const dir = p('instances');
  if (!fs.existsSync(dir)) return [];
  const out: Instance[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const inst = readInstance(entry.name);
    if (inst) out.push(withCover(inst));
  }
  return out.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''));
}

function withCover(inst: Instance): Instance {
  if (!inst.coverImage) return inst;
  try {
    const file = path.join(instanceDir(inst.id), inst.coverImage);
    if (fs.existsSync(file) && fs.statSync(file).size < 4 * 1024 * 1024) {
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      return { ...inst, coverDataUrl: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
    }
  } catch {
    /* обложка недоступна — покажем градиент */
  }
  return inst;
}

/** Установить обложку сборки (копируется в папку сборки). */
export async function setInstanceCover(id: string, sourceFile: string): Promise<Instance | null> {
  const inst = readInstance(id);
  if (!inst) return null;
  const ext = path.extname(sourceFile).toLowerCase() || '.png';
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error('Поддерживаются PNG, JPG и WebP');
  }
  const fileName = `cover${ext}`;
  const target = path.join(instanceDir(id), fileName);
  await fsp.copyFile(sourceFile, target);
  if (inst.coverImage && inst.coverImage !== fileName) {
    await fsp.rm(path.join(instanceDir(id), inst.coverImage), { force: true });
  }
  const next = { ...inst, coverImage: fileName };
  await writeInstance(next);
  return withCover(next);
}

export async function removeInstanceCover(id: string): Promise<Instance | null> {
  const inst = readInstance(id);
  if (!inst) return null;
  if (inst.coverImage) await fsp.rm(path.join(instanceDir(id), inst.coverImage), { force: true });
  const next = { ...inst, coverImage: undefined };
  await writeInstance(next);
  return withCover(next);
}

export interface CreateInstanceInput {
  name: string;
  gameVersion: string;
  loader: LoaderSpec;
  memoryMb?: number;
  javaPath?: string;
  source?: Instance['source'];
  iconHue?: number;
}

export async function createInstance(input: CreateInstanceInput): Promise<Instance> {
  const id = `${slug(input.name) || 'instance'}-${randomUUID().slice(0, 6)}`;
  const dir = instanceDir(id);
  await fsp.mkdir(dir, { recursive: true });
  for (const sub of SUBDIRS) await fsp.mkdir(path.join(dir, sub), { recursive: true });
  const instance: Instance = {
    id,
    name: input.name.trim() || 'Новая сборка',
    gameVersion: input.gameVersion,
    loader: input.loader,
    createdAt: new Date().toISOString(),
    favorite: false,
    iconHue: input.iconHue ?? Math.floor(Math.random() * 360),
    memoryMb: input.memoryMb,
    javaPath: input.javaPath,
    source: input.source ?? { kind: 'manual' },
    playtimeMinutes: 0
  };
  await writeInstance(instance);
  return instance;
}

export async function writeInstance(instance: Instance): Promise<void> {
  const file = instanceJsonPath(instance.id);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(instance, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

export async function updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | null> {
  const current = readInstance(id);
  if (!current) return null;
  const next = { ...current, ...patch, id: current.id };
  await writeInstance(next);
  return next;
}

export async function deleteInstance(id: string): Promise<boolean> {
  const dir = instanceDir(id);
  if (!fs.existsSync(dir)) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  return true;
}

export async function duplicateInstance(id: string, newName?: string): Promise<Instance | null> {
  const source = readInstance(id);
  if (!source) return null;
  const copy = await createInstance({
    name: newName ?? `${source.name} (копия)`,
    gameVersion: source.gameVersion,
    loader: source.loader,
    memoryMb: source.memoryMb,
    iconHue: source.iconHue,
    source: source.source
  });
  const from = instanceDir(id);
  const to = instanceDir(copy.id);
  for (const sub of SUBDIRS) {
    await fsp.cp(path.join(from, sub), path.join(to, sub), { recursive: true, force: true });
  }
  return copy;
}

export async function openInstanceFolder(id: string): Promise<string> {
  const dir = instanceDir(id);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/* --------------------------- Установленные моды --------------------------- */

export function modsFile(id: string): string {
  return path.join(instanceDir(id), 'mods', '.ploxel-mods.json');
}

export function readMods(id: string): InstalledMod[] {
  try {
    return JSON.parse(fs.readFileSync(modsFile(id), 'utf8')) as InstalledMod[];
  } catch {
    return [];
  }
}

export async function writeMods(id: string, mods: InstalledMod[]): Promise<void> {
  await fsp.mkdir(path.dirname(modsFile(id)), { recursive: true });
  await fsp.writeFile(modsFile(id), JSON.stringify(mods, null, 2), 'utf8');
}

/** Сколько миров лежит в сборке — для предупреждения при удалении. */
export function countWorlds(id: string): number {
  const saves = path.join(instanceDir(id), 'saves');
  if (!fs.existsSync(saves)) return 0;
  return fs.readdirSync(saves, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}