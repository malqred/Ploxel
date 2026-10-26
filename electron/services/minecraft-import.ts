import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createInstance } from './instances';
import { installLoader } from './loaders';
import { scanMods, persistMods } from './mods';
import { instanceDir } from './paths';
import type { Instance, LoaderKind, LoaderSpec } from '../../shared/types';

/**
 * Импорт существующей папки .minecraft: переносим содержимое в изолированную
 * сборку. Файлы версий/ассетов не копируем — их лаунчер скачает сам.
 */

const COPY_DIRS = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves', 'screenshots'];
const COPY_FILES = ['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt'];

export interface MinecraftImportInput {
  folder: string;
  name: string;
  gameVersion: string;
  loader: LoaderSpec;
}

export async function importMinecraftFolder(input: MinecraftImportInput): Promise<Instance> {
  const src = path.resolve(input.folder);
  if (!fs.existsSync(src)) throw new Error('Папка .minecraft не найдена');
  const isMinecraft = fs.existsSync(path.join(src, 'versions')) || fs.existsSync(path.join(src, 'mods'));
  if (!isMinecraft) throw new Error('Это не похоже на папку .minecraft (нет versions/ или mods/)');

  const instance = await createInstance({
    name: input.name || 'Импорт .minecraft',
    gameVersion: input.gameVersion,
    loader: input.loader,
    source: { kind: 'import' }
  });

  if (input.loader.kind !== 'vanilla' && input.loader.version) {
    await installLoader(input.gameVersion, input.loader.kind as LoaderKind, input.loader.version);
  }

  const dest = src;
  const instanceRoot = instanceDir(instance.id);
  for (const dir of COPY_DIRS) {
    const from = path.join(dest, dir);
    if (!fs.existsSync(from)) continue;
    await fsp.cp(from, path.join(instanceRoot, dir), { recursive: true, force: true });
  }
  for (const file of COPY_FILES) {
    const from = path.join(dest, file);
    if (!fs.existsSync(from)) continue;
    await fsp.copyFile(from, path.join(instanceRoot, file)).catch(() => undefined);
  }

  // Метаданные локальных модов: пополняем при первом сканировании.
  const mods = scanMods(instance.id);
  await persistMods(instance.id, mods);
  return instance;
}