import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { duplicateInstance, readInstance, updateInstance } from './instances';
import { contentDir, installProject, scanMods } from './mods';
import { catalogVersions } from './catalog';
import { listLoaderVersions } from './loaders';
import { createTask, finishTask, updateTask } from './downloader';
import { compareGameVersions } from '../../shared/game-versions';
import type { Instance, InstalledMod } from '../../shared/types';

export interface MigrationItem {
  name: string;
  kind: InstalledMod['kind'];
  fileName: string;
  /** ok — есть версия под новую игру; keep — пак без версии, оставляем тот же файл;
   *  missing — версии нет (мод будет выключен в копии); local — свой файл, каталогу неизвестен */
  status: 'ok' | 'keep' | 'missing' | 'local';
  source?: 'modrinth' | 'curseforge';
  projectId?: string;
  versionId?: string;
  newVersion?: string;
}

export interface MigrationPlan {
  from: string;
  to: string;
  loader: Instance['loader']['kind'];
  /** загрузчик есть под новую версию игры */
  loaderAvailable: boolean;
  items: MigrationItem[];
  /** модов (только моды) с версией под новую игру / всего модов */
  modsOk: number;
  modsTotal: number;
  /** понижение версии: миры из новой игры в старой могут не открыться */
  downgrade: boolean;
}

/**
 * Что получится, если перенести сборку на другую версию игры: для каждого мода
 * ищем файл под новую версию и тот же загрузчик. Ничего не меняет.
 */
export async function planMigration(instanceId: string, to: string): Promise<MigrationPlan> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const loader = instance.loader.kind;
  const loaderAvailable =
    loader === 'vanilla' ||
    (await listLoaderVersions(loader as Exclude<typeof loader, 'vanilla'>, to)
      .then((l) => l.versions.length > 0)
      .catch(() => false));

  const content = scanMods(instanceId).filter((m) => m.kind === 'mod' || m.kind === 'resourcepack' || m.kind === 'shader');
  // По несколько запросов сразу: на сборке из сотни модов по одному это минуты
  const items: MigrationItem[] = new Array(content.length);
  let next = 0;
  const worker = async () => {
    while (next < content.length) {
      const i = next++;
      items[i] = await planOne(content[i], to, loader);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, content.length) }, worker));

  const mods = items.filter((i) => i.kind === 'mod');
  return {
    from: instance.gameVersion,
    to,
    loader,
    loaderAvailable,
    items,
    modsOk: mods.filter((i) => i.status === 'ok').length,
    modsTotal: mods.length,
    downgrade: compareGameVersions(to, instance.gameVersion) < 0
  };
}

async function planOne(m: InstalledMod, to: string, loader: string): Promise<MigrationItem> {
  const base = { name: m.name || m.fileName, kind: m.kind, fileName: m.fileName };
  if (!m.projectId || m.source === 'local') {
    // Ресурспаки и шейдеры обычно работают на разных версиях — оставляем как есть
    return { ...base, status: m.kind === 'mod' ? 'local' : 'keep' };
  }
  const versions = await catalogVersions(m.source, m.projectId, to, m.kind === 'mod' && loader !== 'vanilla' ? loader : undefined).catch(() => []);
  const v = versions.find((x) => x.files.length) ?? versions[0];
  if (!v || !v.files.length) return { ...base, status: m.kind === 'mod' ? 'missing' : 'keep', source: m.source, projectId: m.projectId };
  return { ...base, status: 'ok', source: m.source, projectId: m.projectId, versionId: v.id, newVersion: v.versionNumber || v.name };
}

export interface MigrationResult {
  instance: Instance;
  updated: number;
  disabled: string[];
}

/**
 * Копия сборки на другой версии игры: моды с версией под неё обновляются,
 * остальные выключаются (файл остаётся — можно включить, когда автор обновит).
 * Исходная сборка не меняется. Идёт фоновой задачей в «Загрузках».
 */
export async function applyMigration(instanceId: string, to: string): Promise<MigrationResult> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const taskId = createTask(`Перенос «${instance.name}» на ${to}`, 'Проверка модов');
  updateTask(taskId, { status: 'running', total: 100, done: 0 });
  try {
    const plan = await planMigration(instanceId, to);
    if (!plan.loaderAvailable) throw new Error(`Загрузчик ${instance.loader.kind} для Minecraft ${to} не найден.`);
    updateTask(taskId, { detail: 'Копирование сборки', done: 10 });
    const copy = await duplicateInstance(instanceId, `${instance.name} (${to})`);
    if (!copy) throw new Error('Не удалось скопировать сборку');
    // Версию загрузчика не задаём: при первом запуске выберется последняя под новую игру
    const moved = (await updateInstance(copy.id, { gameVersion: to, loader: { kind: instance.loader.kind }, lastPlayedAt: undefined, playtimeMinutes: 0 })) ?? copy;

    const toUpdate = plan.items.filter((i) => i.status === 'ok');
    const toDisable = plan.items.filter((i) => i.kind === 'mod' && (i.status === 'missing' || i.status === 'local'));
    let updated = 0;
    for (const item of toUpdate) {
      updateTask(taskId, { detail: `Обновление модов: ${updated} из ${toUpdate.length}`, done: 15 + Math.round((updated / Math.max(1, toUpdate.length)) * 80) });
      const dir = contentDir(moved.id, item.kind);
      try {
        // Сначала новый файл, потом удаляем старый: если загрузка не удалась, мод останется
        const res = await installProject(moved, item.source!, item.projectId!, item.kind, { versionId: item.versionId, projectName: item.name, withDependencies: true });
        if (res.installed.fileName !== item.fileName) await fsp.rm(path.join(dir, item.fileName), { force: true });
        updated++;
      } catch {
        if (item.kind === 'mod') toDisable.push(item);
      }
    }
    const disabled: string[] = [];
    for (const item of toDisable) {
      const file = path.join(contentDir(moved.id, item.kind), item.fileName);
      if (fs.existsSync(file) && !file.endsWith('.disabled')) {
        await fsp.rename(file, `${file}.disabled`).catch(() => undefined);
        disabled.push(item.name);
      }
    }
    finishTask(taskId);
    return { instance: readInstance(moved.id) ?? moved, updated, disabled };
  } catch (e) {
    finishTask(taskId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
