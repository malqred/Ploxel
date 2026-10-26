import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { data } from './paths';
import { downloadMany, fetchJson, fileOk, type DownloadItem } from './downloader';
import type { AssetIndex } from '../core/version/types';

const RESOURCES = 'https://resources.download.minecraft.net';

export function assetsRoot(): string {
  return data('assets');
}

export function objectPath(hash: string): string {
  return path.join(assetsRoot(), 'objects', hash.slice(0, 2), hash);
}

/** Скачивает индекс ассетов и все объекты. Возвращает число файлов. */
export async function ensureAssetIndex(
  indexId: string,
  indexUrl: string,
  sha1: string | undefined,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const indexFile = path.join(assetsRoot(), 'indexes', `${indexId}.json`);
  const ok = await fileOk(indexFile, sha1);
  if (!ok) {
    await fsp.mkdir(path.dirname(indexFile), { recursive: true });
    await downloadMany([{ url: indexUrl, dest: indexFile, sha1 }], { onProgress: () => {}, signal });
  }
  const index = JSON.parse(await fsp.readFile(indexFile, 'utf8')) as AssetIndex;

  const items: DownloadItem[] = [];
  for (const obj of Object.values(index.objects)) {
    items.push({
      url: `${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      dest: objectPath(obj.hash),
      sha1: obj.hash,
      size: obj.size
    });
  }
  await downloadMany(items, {
    concurrency: 8,
    signal,
    onProgress: (done, total) => onProgress(done, total + 1)
  });

  // Старые версии (до 1.7) читают ассеты из папки, а не из хэш-хранилища.
  if (index.virtual || index.map_to_resources) {
    const base = index.map_to_resources
      ? path.join(assetsRoot(), 'virtual', indexId)
      : path.join(assetsRoot(), 'virtual', indexId);
    await fsp.mkdir(base, { recursive: true });
    for (const [name, obj] of Object.entries(index.objects)) {
      const target = path.join(base, ...name.split('/'));
      if (fs.existsSync(target)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      try {
        await fsp.copyFile(objectPath(obj.hash), target);
      } catch {
        /* пропускаем битый объект — игра докачает сама */
      }
    }
  }
}

/**
 * Конфиг логирования log4j.
 *
 * Официальный launchercontent-конфиг Mojang пишет консоль в XML (LegacyXMLLayout):
 * официальный лаунчер умеет его разбирать, а нам нужен обычный текст для консоли
 * и ИИ-помощника. Поэтому используем собственный конфиг с тем же набором
 * приложений, но читаемым текстовым форматом.
 */
export async function ensureLogConfig(_id: string, _url?: string, _sha1?: string): Promise<string> {
  const dest = path.join(assetsRoot(), 'log_configs', 'ploxel-client.xml');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
  <Appenders>
    <Console name="SysOut" target="SYSTEM_OUT">
      <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level] [%logger{20}]: %msg%n"/>
    </Console>
  </Appenders>
  <Loggers>
    <Root level="info"><AppenderRef ref="SysOut"/></Root>
  </Loggers>
</Configuration>
`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, content, 'utf8');
  return dest;
}

export async function getAssetIndexFile(indexId: string): Promise<string> {
  return path.join(assetsRoot(), 'indexes', `${indexId}.json`);
}

export { fetchJson };