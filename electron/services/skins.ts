import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getRoot } from './paths';
import { getMinecraftToken } from './microsoft';
import { getStoredAccount } from './accounts';
import type { SkinLayers } from '../../shared/types';

export interface SkinState {
  current: string | null;
  currentName: string | null;
  variant: 'classic' | 'slim';
  layers: SkinLayers;
  library: { file: string; name: string; dataUrl: string }[];
}

interface LibraryFile {
  current: string | null;
  variant: 'classic' | 'slim';
  layers: SkinLayers;
}

const DEFAULT_LAYERS: SkinLayers = { hat: true, jacket: true, sleeves: true, pants: true };

function skinsRoot(): string {
  const dir = path.join(getRoot(), 'skins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function libraryFile(): string {
  return path.join(skinsRoot(), 'library.json');
}

function readLibrary(): LibraryFile {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryFile(), 'utf8')) as Partial<LibraryFile>;
    return {
      current: raw.current ?? null,
      variant: raw.variant === 'slim' ? 'slim' : 'classic',
      layers: { ...DEFAULT_LAYERS, ...(raw.layers ?? {}) }
    };
  } catch {
    return { current: null, variant: 'classic', layers: DEFAULT_LAYERS };
  }
}

function writeLibrary(next: LibraryFile) {
  fs.writeFileSync(libraryFile(), JSON.stringify(next, null, 2), 'utf8');
}

function dataUrl(file: string): string {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Папка со скинами пользователя. */
export function skinsFolder(): string {
  return skinsRoot();
}

/**
 * Копии «под тонкие/широкие руки» больше не создаются: лаунчер подстраивает
 * руки на лету. Копии, оставшиеся от прошлых сборок 1.0.0
 * (<имя>-slim|classic-xxxxxx.png), удаляются, если оригинал на месте.
 */
export function removeVariantTwins(): number {
  const dir = skinsRoot();
  const lib = readLibrary();
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    const m = /^(.+)-(classic|slim)-[0-9a-f]{6}\.png$/.exec(file);
    if (!m || !fs.existsSync(path.join(dir, `${m[1]}.png`))) continue;
    try {
      fs.rmSync(path.join(dir, file));
      removed++;
      if (lib.current === file) lib.current = `${m[1]}.png`;
    } catch {
      /* файл занят — попробуем в следующий раз */
    }
  }
  if (removed) writeLibrary(lib);
  return removed;
}

/** Сохранить скин (PNG data-URL) в выбранный пользователем файл. */
export async function exportSkin(pngDataUrl: string, target: string): Promise<string> {
  const match = /^data:image\/png;base64,(.+)$/.exec(pngDataUrl);
  if (!match) throw new Error('Ожидается PNG-картинка');
  const file = target.toLowerCase().endsWith('.png') ? target : `${target}.png`;
  await fsp.writeFile(file, Buffer.from(match[1], 'base64'));
  return file;
}

export function getSkinState(): SkinState {
  removeVariantTwins();
  const lib = readLibrary();
  const dir = skinsRoot();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
  const library = files.map((file) => ({
    file,
    name: file.replace(/\.png$/, ''),
    dataUrl: dataUrl(path.join(dir, file))
  }));
  const current = lib.current && fs.existsSync(path.join(dir, lib.current)) ? dataUrl(path.join(dir, lib.current)) : null;
  return {
    current,
    currentName: lib.current,
    variant: lib.variant,
    layers: lib.layers,
    library
  };
}

async function saveSkinBuffer(buf: Buffer, name?: string): Promise<SkinState> {
  if (buf.length < 100) throw new Error('Файл слишком маленький для скина');
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
    throw new Error('Нужен PNG-файл скина');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Размер скина ${width}×${height}. Нужен 64×64 (современный) или 64×32 (старый).`);
  }
  const file = `${(name || 'skin').replace(/[^\w-]+/g, '-').slice(0, 24) || 'skin'}-${crypto.randomUUID().slice(0, 6)}.png`;
  await fsp.writeFile(path.join(skinsRoot(), file), buf);
  const lib = readLibrary();
  lib.current = file;
  writeLibrary(lib);
  return getSkinState();
}

/** Проверяет, что PNG — корректный скин Minecraft, и сохраняет его локально. */
export async function importSkin(sourcePath: string, name?: string): Promise<SkinState> {
  return saveSkinBuffer(await fsp.readFile(sourcePath), name);
}

/** Сохранить скин, нарисованный во встроенном редакторе. */
export async function saveSkinFromDataUrl(dataUrl: string, name = 'painted'): Promise<SkinState> {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Ожидается PNG-картинка');
  return saveSkinBuffer(Buffer.from(match[1], 'base64'), name);
}

export function selectSkin(file: string): SkinState {
  const dir = skinsRoot();
  const target = path.resolve(dir, file);
  if (!target.startsWith(path.resolve(dir)) || !fs.existsSync(target)) throw new Error('Файл скина не найден');
  const lib = readLibrary();
  lib.current = path.basename(target);
  writeLibrary(lib);
  return getSkinState();
}

export function setVariant(variant: 'classic' | 'slim'): SkinState {
  const lib = readLibrary();
  lib.variant = variant;
  writeLibrary(lib);
  return getSkinState();
}

export function setLayers(layers: Partial<SkinLayers>): SkinState {
  const lib = readLibrary();
  lib.layers = { ...lib.layers, ...layers };
  writeLibrary(lib);
  return getSkinState();
}

export function clearLocalSkin(): SkinState {
  const lib = readLibrary();
  lib.current = null;
  writeLibrary(lib);
  return getSkinState();
}

async function tokenFor(accountId: string) {
  const account = getStoredAccount(accountId);
  if (!account) throw new Error('Аккаунт не найден');
  if (account.type !== 'microsoft') {
    throw new Error('Смена скина на серверах Mojang доступна только с аккаунтом Microsoft. Офлайн-скин виден только в предпросмотре.');
  }
  return getMinecraftToken(accountId);
}

/** Загрузка текущего локального скина в аккаунт Microsoft (официальный API). */
export async function uploadCurrentSkin(accountId: string, pngDataUrl?: string): Promise<{ ok: true }> {
  const token = await tokenFor(accountId);
  const lib = readLibrary();
  if (!lib.current) throw new Error('Сначала выберите скин');
  // Интерфейс передаёт текстуру, уже подстроенную под выбранные руки
  const fromUi = pngDataUrl ? /^data:image\/png;base64,(.+)$/.exec(pngDataUrl) : null;
  const buf = fromUi ? Buffer.from(fromUi[1], 'base64') : await fsp.readFile(path.join(skinsRoot(), lib.current));
  const form = new FormData();
  form.set('variant', lib.variant);
  form.set('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: form
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mojang отклонил скин (${res.status}): ${text.slice(0, 200)}`);
  }
  return { ok: true };
}

export async function resetAccountSkin(accountId: string): Promise<void> {
  const token = await tokenFor(accountId);
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins/active', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token.accessToken}` }
  });
  if (!res.ok && res.status !== 204) throw new Error(`Не удалось сбросить скин (${res.status})`);
}

export interface CapeInfo {
  id: string;
  name: string;
  url?: string;
  active: boolean;
}

export async function getCapes(accountId: string): Promise<CapeInfo[]> {
  const token = await tokenFor(accountId);
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/capes', {
    headers: { Authorization: `Bearer ${token.accessToken}` }
  });
  if (!res.ok) throw new Error(`Не удалось получить плащи (${res.status})`);
  const json = (await res.json()) as { capes: { id: string; alias: string; state: string; url: string }[] };
  return (json.capes ?? []).map((c) => ({ id: c.id, name: c.alias, url: c.url, active: c.state === 'ACTIVE' }));
}

export async function setCape(accountId: string, capeId: string | null): Promise<void> {
  const token = await tokenFor(accountId);
  const res = capeId
    ? await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ capeId })
      })
    : await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token.accessToken}` }
      });
  if (!res.ok && res.status !== 204) throw new Error(`Не удалось изменить плащ (${res.status})`);
}