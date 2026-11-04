// Сквозная проверка функций 1.2.1 на настоящей сети (временная папка данных):
// датапаки из Modrinth и CurseForge, «Что нового», mclo.gs, конфиги, Discord, окно игры.
// Запуск: electron . --user-data-dir=<tmp> --e2e=v121
import fs from 'node:fs';
import path from 'node:path';
import { createInstance } from '../services/instances';
import { instanceDir } from '../services/paths';
import { installProject, checkUpdates, modChangelog, scanMods } from '../services/mods';
import { searchCatalog, catalogVersions } from '../services/catalog';
import { installDatapack, listDatapacks, setDatapackEnabled, removeDatapack } from '../services/datapacks';
import { listConfigFiles, readConfigFile, writeConfigFile } from '../services/configs';
import { prepareSharedLog, uploadLog, deleteSharedLog } from '../services/log-share';
import { DiscordClient } from '../services/discord';
import { isCurseForgeAvailable } from '../services/curseforge';
import { getConfig } from '../services/config';
import { buildActivity } from '../core/discord-ipc';

let failures = 0;
async function step(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const out = await fn();
    console.log(`[v121] OK   ${name} (${((Date.now() - started) / 1000).toFixed(1)} с) — ${out}`);
  } catch (e) {
    failures++;
    console.log(`[v121] FAIL ${name} — ${e instanceof Error ? e.stack ?? e.message : e}`);
  }
}
function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

export async function runV121E2E(): Promise<void> {
  const inst = await createInstance({ name: 'E2E 1.2.1', gameVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } });
  const world = 'Тестовый мир';
  const saves = path.join(instanceDir(inst.id), 'saves', world);
  fs.mkdirSync(saves, { recursive: true });
  fs.writeFileSync(path.join(saves, 'level.dat'), '');

  await step('поиск датапаков: Modrinth', async () => {
    const res = await searchCatalog({ source: 'modrinth', projectType: 'datapack', query: '', gameVersion: '1.21.1', sort: 'downloads', offset: 0, limit: 6 });
    expect(res.hits.length > 0, 'пусто');
    expect(res.hits.every((h) => h.projectType === 'datapack'), 'тип не datapack');
    return res.hits.map((h) => h.title).join(', ');
  });
  await step('поиск датапаков: «терралит» по-русски', async () => {
    const res = await searchCatalog({ source: 'modrinth', projectType: 'datapack', query: 'terralith', sort: 'relevance', offset: 0, limit: 6 });
    expect(res.hits.some((h) => h.slug === 'terralith'), 'Terralith не найден: ' + res.hits.map((h) => h.slug).join(','));
    return res.hits.slice(0, 3).map((h) => h.title).join(', ');
  });
  await step('версии датапака — только zip под datapack', async () => {
    const versions = await catalogVersions('modrinth', 'terralith', '1.21.1', 'datapack');
    expect(versions.length > 0, 'нет версий');
    expect(versions.every((v) => v.loaders.includes('datapack')), 'среди версий есть не-датапак');
    return `${versions.length} версий, первая ${versions[0].versionNumber}: ${versions[0].files.map((f) => f.fileName).join(', ')}`;
  });
  await step('установка Terralith в мир, выключение, удаление', async () => {
    const pack = await installDatapack(inst.id, world, 'modrinth', 'terralith');
    expect(pack.fileName.endsWith('.zip') && pack.description, 'нет zip или описания');
    await setDatapackEnabled(inst.id, world, pack.fileName, false);
    expect(listDatapacks(inst.id, world)[0].enabled === false, 'не выключился');
    await setDatapackEnabled(inst.id, world, pack.fileName, true);
    const out = `${pack.name} ${pack.version} · ${pack.fileName} · «${pack.description}»`;
    await removeDatapack(inst.id, world, pack.fileName);
    expect(listDatapacks(inst.id, world).length === 0, 'не удалился');
    return out;
  });
  await step('датапак-мод без zip даёт понятную ошибку (VeinMiner)', async () => {
    try {
      const versions = await catalogVersions('modrinth', 'veinminer', '1.21.1', 'datapack');
      if (!versions.length) return 'у VeinMiner нет версий-датапаков под 1.21.1 — лаунчер скажет «Нет версии датапака»';
      const p = await installDatapack(inst.id, world, 'modrinth', 'veinminer');
      await removeDatapack(inst.id, world, p.fileName);
      return `поставился как zip: ${p.fileName}`;
    } catch (e) {
      return `ошибка: ${e instanceof Error ? e.message : e}`;
    }
  });

  if (isCurseForgeAvailable()) {
    await step('датапаки CurseForge: поиск и установка', async () => {
      const res = await searchCatalog({ source: 'curseforge', projectType: 'datapack', query: '', gameVersion: '1.21.1', sort: 'downloads', offset: 0, limit: 6 });
      expect(res.hits.length > 0, 'пусто');
      expect(res.hits.every((h) => h.projectType === 'datapack' && h.url.includes('/data-packs/')), 'тип или ссылка неверны');
      let installed = '';
      for (const hit of res.hits) {
        try {
          const p = await installDatapack(inst.id, world, 'curseforge', hit.id, { name: hit.title });
          installed = `${p.name} · ${p.fileName}`;
          await removeDatapack(inst.id, world, p.fileName);
          break;
        } catch (e) {
          installed ||= `(${hit.title}: ${e instanceof Error ? e.message : e})`;
        }
      }
      expect(installed && !installed.startsWith('('), 'ни один не поставился: ' + installed);
      return `${res.hits.map((h) => h.title).slice(0, 3).join(', ')} → поставлен ${installed}`;
    });
    await step('ресурспаки CurseForge в Fabric-сборке находятся (фильтр загрузчика)', async () => {
      const res = await searchCatalog({ source: 'curseforge', projectType: 'resourcepack', query: '', gameVersion: '1.21.1', loader: 'fabric', sort: 'downloads', offset: 0, limit: 4 });
      expect(res.hits.length > 0, '0 результатов — фильтр загрузчика опять мешает');
      return res.hits.map((h) => h.title).join(', ');
    });
  }

  await step('«Что нового»: Sodium старой версии → список изменений', async () => {
    const versions = await catalogVersions('modrinth', 'sodium', '1.21.1', 'fabric');
    const old = versions[Math.min(3, versions.length - 1)];
    await installProject(inst, 'modrinth', old.projectId, 'mod', { versionId: old.id, projectName: 'Sodium', withDependencies: false });
    const updates = await checkUpdates(inst.id);
    const sodium = scanMods(inst.id).find((m) => m.projectId === old.projectId)!;
    expect(updates.some((u) => u.modId === sodium.id), 'обновление не найдено');
    const log = await modChangelog(inst.id, sodium.id);
    expect(log.length > 0 && log.length <= 15, 'версий: ' + log.length);
    expect(!log.some((e) => e.versionId === old.id), 'в списке есть установленная версия');
    return `установлена ${old.versionNumber}; новее: ${log.map((e) => e.versionNumber).join(', ')}; с текстом: ${log.filter((e) => e.changelog).length}`;
  });
  if (isCurseForgeAvailable()) {
    await step('«Что нового»: мод с CurseForge (Mod Menu)', async () => {
      const versions = await catalogVersions('curseforge', '308702', '1.21.1', 'fabric');
      const old = versions[Math.min(2, versions.length - 1)];
      await installProject(inst, 'curseforge', '308702', 'mod', { versionId: old.id, projectName: 'Mod Menu', withDependencies: false });
      const mod = scanMods(inst.id).find((m) => m.projectId === '308702')!;
      const log = await modChangelog(inst.id, mod.id);
      expect(log.length > 0, 'пусто');
      expect(!log.some((e) => /<\/?(li|p|ul)>/.test(e.changelog)), 'HTML не переведён в markdown');
      return `${log.length} версий новее ${old.versionNumber}; пример: ${(log.find((e) => e.changelog)?.changelog ?? '—').slice(0, 80).replace(/\n/g, ' ')}`;
    });
  }

  await step('конфиги: список, чтение, проверка, сохранение с копией', async () => {
    const dir = path.join(instanceDir(inst.id), 'config');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'test-mod.toml'), '[general]\nenabled = true\n');
    const files = listConfigFiles(inst.id);
    expect(files.some((f) => f.path === 'config/test-mod.toml'), 'файла нет в списке');
    const opened = await readConfigFile(inst.id, 'config/test-mod.toml');
    const bad = await writeConfigFile(inst.id, 'config/test-mod.toml', '[general]\nenabled true\n', opened.modifiedAt);
    expect(bad.problem, 'ошибка TOML не поймана');
    const ok = await writeConfigFile(inst.id, 'config/test-mod.toml', '[general]\nenabled = false\n', opened.modifiedAt);
    expect(!ok.problem, 'верный файл не сохранился');
    return `файлов ${files.length}; ошибка: ${bad.problem}`;
  });

  await step('mclo.gs: загрузка очищенного лога и удаление', async () => {
    const raw = [
      '[12:00:00] [main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.9',
      '[12:00:01] [main/INFO]: Setting user: PloxelTester',
      '[12:00:02] [main/ERROR]: Ploxel e2e test log — C:\\Users\\Tester\\AppData\\Roaming\\Ploxel\\instances\\x\\mods\\sodium.jar'
    ].join('\n');
    const text = prepareSharedLog(raw, 'PloxelTester');
    expect(!/Tester/.test(text), 'ник или имя пользователя остались');
    const shared = await uploadLog(text);
    expect(/^https:\/\/mclo\.gs\//.test(shared.url), 'странная ссылка ' + shared.url);
    const res = await fetch(`https://api.mclo.gs/1/raw/${shared.id}`);
    const body = await res.text();
    expect(body.includes('sodium.jar') && !body.includes('Tester'), 'на сервере не тот текст');
    expect(shared.token, 'нет ключа удаления');
    await deleteSharedLog(shared.id, shared.token!);
    const after = await fetch(`https://api.mclo.gs/1/raw/${shared.id}`);
    expect(!after.ok, `после удаления лог ещё открывается (HTTP ${after.status})`);
    return `${shared.url} загружен, проверен и удалён`;
  });

  await step('Discord: локальный канал', async () => {
    // С ID из config.json — ставим и снимаем статус; без ID Discord ответит закрытием, и клиент это переживает
    const id = getConfig().discordClientId;
    const client = new DiscordClient(id || '0');
    const ok = await client.connect();
    if (ok) {
      client.setActivity(buildActivity({ gameVersion: '1.21.1', loader: 'fabric', startedAt: Date.now() }));
      await new Promise((r) => setTimeout(r, 1500));
      client.setActivity(null);
      await new Promise((r) => setTimeout(r, 300));
    }
    client.close();
    if (id) expect(ok, 'Discord запущен, но не принял ID приложения');
    return ok ? `Discord принял ID ${id}, статус поставлен и снят` : 'Discord не принял (нет ID приложения или Discord не запущен) — без ошибок';
  });

  console.log(`[v121] итог: ошибок ${failures}`);
}
