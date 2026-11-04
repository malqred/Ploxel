import fsp from 'node:fs/promises';
import path from 'node:path';
import { instanceDir } from './paths';
import { readInstance } from './instances';
import { importWorld } from './worlds';
import { downloadFile } from './downloader';
import { catalogVersions } from './catalog';
import type { CatalogVersion, WorldInfo } from '../../shared/types';

/**
 * Мир из каталога (CurseForge, раздел «Worlds»): zip скачивается и распаковывается
 * в saves сборки тем же импортом, что и свой архив. Сначала ищется файл под версию
 * сборки; если его нет — берётся самый новый (карты обычно открываются и в новых версиях).
 */
export async function installWorldFromCatalog(
  instanceId: string,
  source: 'modrinth' | 'curseforge',
  projectId: string,
  opts: { versionId?: string; name?: string } = {}
): Promise<WorldInfo> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  let version: CatalogVersion | undefined;
  if (opts.versionId) {
    version = (await catalogVersions(source, projectId)).find((v) => v.id === opts.versionId);
  } else {
    version = (await catalogVersions(source, projectId, instance.gameVersion))[0] ?? (await catalogVersions(source, projectId))[0];
  }
  if (!version) throw new Error('У этого мира нет файлов для скачивания');
  const isZip = (name: string) => name.toLowerCase().endsWith('.zip');
  const file = version.files.find((f) => f.primary && isZip(f.fileName)) ?? version.files.find((f) => isZip(f.fileName));
  if (!file) {
    throw new Error(
      version.files.length
        ? 'У этой версии мира нет zip-архива. Выберите другую версию.'
        : 'Автор запретил скачивание через сторонние лаунчеры. Скачайте архив на странице проекта и добавьте его в «Мирах» сборки кнопкой «Импорт».'
    );
  }
  const tmp = path.join(instanceDir(instanceId), `.ploxel-world-${projectId}.zip`);
  try {
    await downloadFile({ url: file.url, dest: tmp, sha1: file.hashes?.sha1, size: file.size });
    return await importWorld(instanceId, tmp, opts.name);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}
