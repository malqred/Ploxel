import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { instanceDir, p } from './paths';
import { listInstances, readInstance } from './instances';
import { parseNbt, asCompound, asString, asNumber } from '../core/nbt';
import type { WorldInfo } from '../../shared/types';

export function listWorlds(instanceId?: string): WorldInfo[] {
  const instances = instanceId ? listInstances().filter((i) => i.id === instanceId) : listInstances();
  const out: WorldInfo[] = [];
  for (const inst of instances) {
    const saves = path.join(instanceDir(inst.id), 'saves');
    if (!fs.existsSync(saves)) continue;
    for (const entry of fs.readdirSync(saves, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(saves, entry.name);
      const info = readWorld(dir, inst.id);
      if (info) out.push(info);
    }
  }
  return out.sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
}

function readWorld(dir: string, instanceId: string): WorldInfo | null {
  const levelDat = path.join(dir, 'level.dat');
  if (!fs.existsSync(levelDat)) return null;
  const info: WorldInfo = {
    instanceId,
    folder: path.basename(dir),
    name: path.basename(dir),
    sizeBytes: dirSize(dir)
  };
  try {
    const { value } = parseNbt(fs.readFileSync(levelDat));
    const data = asCompound(asCompound(value).Data);
    info.name = asString(data.LevelName, info.name);
    info.gameVersion = asString(asCompound(data.Version).Name, '');
    if (!info.gameVersion) {
      info.gameVersion = `снапшот ${asNumber(asCompound(data.Version).Snapshot, 0)}`;
    }
    const last = data.LastPlayed;
    if (typeof last === 'bigint') info.lastPlayed = new Date(Number(last)).toISOString();
    else if (typeof last === 'number') info.lastPlayed = new Date(last).toISOString();
    info.isHardcore = data.hardcore === 1 || data.Hardcore === 1;
  } catch {
    /* старый или повреждённый level.dat — показываем хотя бы папку */
  }
  const icon = path.join(dir, 'icon.png');
  try {
    if (fs.existsSync(icon) && fs.statSync(icon).size < 512 * 1024) {
      info.icon = `data:image/png;base64,${fs.readFileSync(icon).toString('base64')}`;
    }
  } catch {
    /* без иконки */
  }
  return info;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  } catch {
    /* нет доступа — считаем 0 */
  }
  return total;
}

/** Импорт мира из zip. Возвращает имя папки мира. */
export async function importWorld(instanceId: string, zipFile: string): Promise<WorldInfo> {
  if (!readInstance(instanceId)) throw new Error('Сборка не найдена');
  const zip = new AdmZip(zipFile);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw new Error('Архив пуст');

  const levelEntry = entries.find((e) => e.entryName === 'level.dat' || e.entryName.endsWith('/level.dat'));
  if (!levelEntry) throw new Error('В архиве нет level.dat — это не сохранение Minecraft');

  const rootPrefix = levelEntry.entryName === 'level.dat' ? '' : levelEntry.entryName.slice(0, -'level.dat'.length);
  let folderName = path.basename(rootPrefix.replace(/\/$/, '')) || 'Импортированный мир';
  folderName = sanitizeName(folderName);
  const savesDir = path.join(instanceDir(instanceId), 'saves');
  await fsp.mkdir(savesDir, { recursive: true });
  let target = path.join(savesDir, folderName);
  let counter = 2;
  while (fs.existsSync(target)) {
    target = path.join(savesDir, `${folderName} (${counter++})`);
  }
  await fsp.mkdir(target, { recursive: true });

  for (const entry of entries) {
    if (!entry.entryName.startsWith(rootPrefix)) continue;
    const rel = entry.entryName.slice(rootPrefix.length);
    if (!rel) continue;
    const dest = path.resolve(target, rel);
    if (!dest.startsWith(path.resolve(target))) throw new Error('Небезопасный путь в архиве');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, entry.getData());
  }
  const info = readWorld(target, instanceId);
  if (!info) throw new Error('Не удалось прочитать импортированный мир');
  return info;
}

/** Экспорт мира в zip (внутри архива — файлы мира в корне). */
export async function exportWorld(instanceId: string, folder: string, targetZip: string): Promise<string> {
  const dir = path.resolve(instanceDir(instanceId), 'saves', folder);
  const savesRoot = path.resolve(instanceDir(instanceId), 'saves');
  if (!dir.startsWith(savesRoot) || !fs.existsSync(dir)) throw new Error('Мир не найден');
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  await fsp.mkdir(path.dirname(targetZip), { recursive: true });
  zip.writeZip(targetZip);
  return targetZip;
}

export function worldFolder(instanceId: string, folder: string): string {
  const dir = path.resolve(instanceDir(instanceId), 'saves', folder);
  const savesRoot = path.resolve(instanceDir(instanceId), 'saves');
  if (!dir.startsWith(savesRoot)) throw new Error('Неверный путь мира');
  return dir;
}

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\.+$/, '')
      .trim()
      .slice(0, 60) || 'Импортированный мир'
  );
}

export function worldsRootHints() {
  return p('instances');
}