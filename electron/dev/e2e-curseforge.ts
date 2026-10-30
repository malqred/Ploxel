// Сквозная проверка всего, что связано с CurseForge (настоящая сеть, временная папка данных).
// Запуск: electron . --user-data-dir=<tmp> --e2e=curseforge [--ai=1] [--pack=1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstance, readInstance } from '../services/instances';
import { contentDir, installProject, scanMods, checkUpdates, updateMod, addLocalFiles, identifyLocalMods } from '../services/mods';
import { buildPlan, installPlan, checkBuild, planAutoFix } from '../services/dependencies';
import { searchCatalog } from '../services/catalog';
import { getModrinthProject, getModrinthVersions } from '../services/modrinth';
import { getCurseForgeProject, getCurseForgeFiles, identifyCurseForgeFiles, isCurseForgeAvailable } from '../services/curseforge';
import { curseforgeFingerprint } from '../core/murmur2';
import { exportCurseForgeZip, installModpackArchive, installModpackFromProject, manualModsCount } from '../services/modpack';
import type { Instance } from '../../shared/types';

const CF = {
  jei: '238222',
  waystones: '245755',
  fabricApi: '306612',
  modMenu: '308702',
  sodium: '394468',
  zoomify: '574741',
  fabulouslyOptimized: '396246'
};

let failures = 0;
async function step(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const out = await fn();
    console.log(`[cf] OK   ${name} (${((Date.now() - started) / 1000).toFixed(1)} с) — ${out}`);
  } catch (e) {
    failures++;
    console.log(`[cf] FAIL ${name} — ${e instanceof Error ? e.stack ?? e.message : e}`, (e as { cause?: unknown })?.cause ?? '');
  }
}
function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const list = (inst: Instance) => scanMods(inst.id).map((m) => `${m.source}:${m.name}`).join(', ');

async function installWithDeps(inst: Instance, source: 'modrinth' | 'curseforge', projectId: string): Promise<string> {
  const plan = await buildPlan(inst, source, projectId);
  const keys = plan.items.filter((i) => i.selected || i.required).filter((i) => !i.installed && !i.incompatible).map((i) => i.key);
  const res = await installPlan(inst, plan, keys);
  return `установлено ${res.installedKeys.length}: ${plan.items.map((i) => `${i.source}:${i.projectName}`).join(', ')}`;
}

/** Модпак Modrinth с модами «только с CurseForge»: скачиваем .mrpack, берём список и докачиваем. */
async function curseForgeOnlyStep(slug: string) {
  await step(`моды «только с CurseForge» из модпака Modrinth (${slug})`, async () => {
    const AdmZip = (await import('adm-zip')).default;
    const { getModrinthVersions: versionsOf } = await import('../services/modrinth');
    const { downloadFile } = await import('../services/downloader');
    const { fetchCurseForgeOnlyMods } = await import('../services/modpack');
    const project = await getModrinthProject(slug);
    const version = (await versionsOf(project!.id))[0];
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ploxel-cfonly-'));
    const pack = path.join(tmp, file.fileName);
    await downloadFile({ url: file.url, dest: pack, sha1: file.hashes?.sha1, size: file.size });
    const entry = new AdmZip(pack).getEntries().find((e) => /missing_mods_checker\.json$/.test(e.entryName));
    expect(entry, 'в модпаке нет missing_mods_checker.json');
    const dir = path.join(tmp, 'instance');
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'missing_mods_checker.json'), entry!.getData());
    const list = JSON.parse(entry!.getData().toString('utf8')) as { pattern?: string }[];
    await fetchCurseForgeOnlyMods(dir);
    const got = fs.existsSync(path.join(dir, 'mods')) ? fs.readdirSync(path.join(dir, 'mods')).filter((f) => f.endsWith('.jar')) : [];
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(got.length > 0, `ничего не скачано из ${list.length}`);
    return `${version.versionNumber}: в списке ${list.length}, скачано ${got.length} (остальные автор разрешил только с сайта)`;
  });
}

export async function runCurseForgeE2E(arg: (name: string) => string | undefined) {
  if (arg('only') === 'export') {
    const inst = await createInstance({ name: 'CF Export', gameVersion: '1.20.1', loader: { kind: 'fabric', version: '0.16.14' } });
    await step('мод из CurseForge для экспорта', async () => (await installProject(inst, 'curseforge', CF.modMenu, 'mod', { withDependencies: false })).installed.fileName);
    await step('экспорт для CurseForge (.zip) и установка обратно', async () => {
      const out = path.join(os.tmpdir(), `ploxel-cf-export-${Date.now()}.zip`);
      await exportCurseForgeZip(inst.id, out);
      const back = await installModpackArchive(out, () => {});
      fs.rmSync(out, { force: true });
      const b = scanMods(back.id);
      expect(b.length === 1 && b[0].source === 'curseforge', 'после импорта: ' + list(back));
      expect(back.loader.kind === 'fabric' && back.loader.version === '0.16.14', 'загрузчик: ' + JSON.stringify(back.loader));
      return `${back.name}: ${list(back)} · ${back.loader.kind} ${back.loader.version}`;
    });
    return;
  }
  if (arg('only') === 'aiprobe') {
    // Сырой ответ сервиса ИИ на короткую просьбу о JSON — чтобы понять, почему он «не список модов»
    const { resolveAiConfig } = await import('../services/ai');
    const cfg = resolveAiConfig();
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.3,
          max_tokens: 2000,
          messages: [
            { role: 'system', content: 'Ответь ТОЛЬКО JSON-объектом: {"mods":[{"name":"..."}]}. Три мода для Forge 1.20.1 про технику.' },
            { role: 'user', content: i === 0 ? 'сборка про технику' : 'Инструкция: ответь ТОЛЬКО JSON-объектом {"mods":[{"name":"..."}]} — три мода Minecraft для Forge 1.20.1.\n\nЗапрос: сборка про технику' }
          ]
        })
      });
      const text = await res.text();
      console.log(`[cf] probe ${i + 1}: HTTP ${res.status}, ${text.length} байт: ${text.slice(0, 700).replace(/\s+/g, ' ')}`);
    }
    return;
  }
  if (arg('only') === 'cfonly') {
    await curseForgeOnlyStep(arg('pack') || 'better-mc-fabric-bmc2');
    return;
  }
  if (arg('only') === 'pack') {
    await step('модпак Fabulously Optimized из CurseForge', async () => {
      const inst = await installModpackFromProject('curseforge', CF.fabulouslyOptimized);
      return `${inst.name} · ${inst.gameVersion} · ${inst.loader.kind} · модов ${scanMods(inst.id).length}, вручную ${manualModsCount(inst.id)}`;
    });
    return;
  }
  console.log('[cf] ключ CurseForge задан:', isCurseForgeAvailable());
  if (!isCurseForgeAvailable()) return;

  /* ---------------- Каталог ---------------- */
  await step('поиск модов (jei, 1.20.1, forge)', async () => {
    const res = await searchCatalog({ source: 'curseforge', projectType: 'mod', query: 'jei', gameVersion: '1.20.1', loader: 'forge', sort: 'relevance', offset: 0, limit: 6 });
    const titles = res.hits.map((h) => h.title);
    expect(titles.some((t) => /Just Enough Items/i.test(t)), 'JEI не найден: ' + titles.join(', '));
    const jei = res.hits.find((h) => /Just Enough Items/i.test(h.title))!;
    expect(jei.loaders.length && jei.gameVersions.length, 'у карточки нет загрузчиков или версий');
    return `${res.total} всего; ${titles.slice(0, 4).join(', ')}; JEI: ${jei.loaders.join('/')} · ${jei.gameVersions.length} версий`;
  });
  await step('поиск по-русски («миникарта»)', async () => {
    const res = await searchCatalog({ source: 'curseforge', projectType: 'mod', query: 'миникарта', sort: 'relevance', offset: 0, limit: 6 });
    expect(res.hits.length, 'пусто');
    return res.hits.map((h) => h.title).slice(0, 4).join(', ');
  });
  await step('категория «оптимизация» (fabric 1.20.1)', async () => {
    const res = await searchCatalog({ source: 'curseforge', projectType: 'mod', query: '', category: 'optimization', gameVersion: '1.20.1', loader: 'fabric', sort: 'downloads', offset: 0, limit: 6 });
    expect(res.hits.length, 'пусто');
    return res.hits.map((h) => h.title).slice(0, 5).join(', ');
  });
  for (const type of ['modpack', 'resourcepack', 'shader'] as const) {
    await step(`поиск: ${type}`, async () => {
      const res = await searchCatalog({ source: 'curseforge', projectType: type, query: '', sort: 'downloads', offset: 0, limit: 4 });
      expect(res.hits.length, 'пусто');
      expect(res.hits.every((h) => h.projectType === type), 'неверный тип: ' + res.hits.map((h) => h.projectType).join(','));
      return res.hits.map((h) => h.title).join(', ');
    });
  }
  await step('страница проекта JEI', async () => {
    const p = await getCurseForgeProject(CF.jei);
    expect(p, 'нет проекта');
    expect((p!.body ?? '').length > 200, 'нет описания');
    return `${p!.title}: тип ${p!.projectType}, описание ${p!.body!.length} симв., галерея ${p!.gallery?.length ?? 0}, ${p!.url}`;
  });
  await step('страница модпака — тип modpack', async () => {
    const p = await getCurseForgeProject(CF.fabulouslyOptimized);
    expect(p?.projectType === 'modpack', 'тип ' + p?.projectType);
    return `${p!.title} · ${p!.url}`;
  });
  await step('версии JEI для forge 1.20.1', async () => {
    const v = await getCurseForgeFiles(CF.jei, '1.20.1', 'forge');
    expect(v.length, 'нет версий');
    const f = v[0];
    expect(f.gameVersions.includes('1.20.1'), 'версии игры: ' + f.gameVersions.join(','));
    expect(f.loaders.includes('forge') && f.loaders.every((l) => ['forge', 'fabric', 'quilt', 'neoforge'].includes(l)), 'загрузчики: ' + f.loaders.join(','));
    expect(f.files[0]?.url, 'нет ссылки');
    return `${v.length} версий; первая ${f.versionNumber} · ${f.loaders.join('/')} · ${f.gameVersions.join(',')}`;
  });

  /* ---------------- Установка (Forge) ---------------- */
  const forge = await createInstance({ name: 'CF Forge', gameVersion: '1.20.1', loader: { kind: 'forge' } });
  await step('Forge: Waystones с зависимостями (CurseForge)', () => installWithDeps(forge, 'curseforge', CF.waystones));
  await step('Forge: JEI (CurseForge)', async () => (await installProject(forge, 'curseforge', CF.jei, 'mod')).installed.fileName);
  await step('Forge: файлы на месте', async () => {
    const mods = scanMods(forge.id);
    for (const m of mods) expect(fs.existsSync(path.join(contentDir(forge.id, 'mod'), m.fileName)), 'нет файла ' + m.fileName);
    expect(mods.some((m) => /balm/i.test(m.name)), 'Balm (зависимость Waystones) не установлен: ' + list(forge));
    return list(forge);
  });
  await step('Forge: поиск неисправностей без ложных пунктов', async () => {
    const issues = (await checkBuild(readInstance(forge.id)!)).filter((i) => i.kind !== 'outdated');
    expect(!issues.length, issues.map((i) => i.title).join(' | '));
    return 'проблем нет';
  });

  /* ---------------- Fabric: дубликаты Modrinth + CurseForge ---------------- */
  const fabric = await createInstance({ name: 'CF Fabric', gameVersion: '1.20.1', loader: { kind: 'fabric', version: '0.16.14' } });
  // Старые версии с Modrinth и новые с CurseForge — разные файлы одного мода
  await step('Fabric: старые Mod Menu и Fabric API с Modrinth', async () => {
    const out: string[] = [];
    for (const slug of ['modmenu', 'fabric-api']) {
      const mr = await getModrinthProject(slug);
      const versions = await getModrinthVersions(mr!.id, '1.20.1', 'fabric');
      const old = versions[versions.length - 1];
      const res = await installProject(fabric, 'modrinth', mr!.id, 'mod', { versionId: old.id, projectName: mr!.title, withDependencies: false });
      out.push(res.installed.fileName);
    }
    return out.join(', ');
  });
  await step('Fabric: зависимость из другого каталога не ставится второй раз', async () => {
    const plan = await buildPlan(fabric, 'curseforge', CF.zoomify);
    const api = plan.items.find((i) => /fabric api/i.test(i.projectName));
    expect(api, 'Fabric API нет в плане: ' + plan.items.map((i) => i.projectName).join(', '));
    expect(api!.installed, `Fabric API будет поставлен второй раз: ${api!.note ?? ''}`);
    return plan.items.map((i) => `${i.projectName}${i.installed ? ` (${i.note})` : ''}`).join(', ');
  });
  await step('Fabric: Mod Menu и Fabric API ещё раз — с CurseForge', async () => {
    const a = await installProject(fabric, 'curseforge', CF.modMenu, 'mod', { withDependencies: false });
    const b = await installProject(fabric, 'curseforge', CF.fabricApi, 'mod', { withDependencies: false });
    return `${a.installed.fileName}, ${b.installed.fileName}; в сборке: ${list(fabric)}`;
  });
  await step('Fabric: поиск неисправностей видит дубликаты из двух каталогов', async () => {
    const issues = await checkBuild(readInstance(fabric.id)!);
    const dups = issues.filter((i) => i.kind === 'duplicate');
    const text = dups.map((d) => d.title).join(' | ');
    expect(dups.some((d) => /mod.?menu/i.test(d.title)), 'нет дубликата Mod Menu: ' + issues.map((i) => i.kind + ':' + i.title).join(' | '));
    expect(dups.some((d) => /fabric.?api/i.test(d.title)), 'нет дубликата Fabric API: ' + text);
    const fixes = planAutoFix(issues).filter((a) => a.action === 'remove-duplicate');
    expect(fixes.length >= 2, 'нет исправлений remove-duplicate');
    return `${dups.length} дубликата: ${text}`;
  });

  /* ---------------- Распознавание ---------------- */
  await step('отпечаток файла CurseForge → проект', async () => {
    const mm = scanMods(fabric.id).find((m) => m.source === 'curseforge' && m.projectId === CF.modMenu);
    expect(mm, 'нет мода из CurseForge');
    const fp = curseforgeFingerprint(fs.readFileSync(path.join(contentDir(fabric.id, 'mod'), mm!.fileName)));
    const found = await identifyCurseForgeFiles([fp]);
    expect(found[fp]?.projectId === CF.modMenu, 'не распознан: ' + JSON.stringify(found));
    return `${found[fp].title} ${found[fp].versionNumber}`;
  });
  await step('файл, добавленный вручную, узнаётся в каталоге', async () => {
    const tmp = await createInstance({ name: 'CF Local', gameVersion: '1.20.1', loader: { kind: 'forge' } });
    const src = scanMods(forge.id).find((m) => m.projectId === CF.waystones);
    const file = path.join(contentDir(forge.id, 'mod'), src!.fileName);
    await addLocalFiles(tmp.id, 'mod', [file]);
    await identifyLocalMods(tmp.id);
    const m = scanMods(tmp.id)[0];
    expect(m && m.source !== 'local' && m.projectId, 'не распознан: ' + JSON.stringify(m));
    return `${m.name} → ${m.source} ${m.projectId}`;
  });

  /* ---------------- Обновления ---------------- */
  await step('обновление мода из CurseForge (старый Sodium → новый)', async () => {
    const versions = await getCurseForgeFiles(CF.sodium, '1.20.1', 'fabric');
    expect(versions.length > 1, 'мало версий Sodium');
    const old = versions[versions.length - 1];
    await installProject(fabric, 'curseforge', CF.sodium, 'mod', { versionId: old.id, withDependencies: false });
    const updates = await checkUpdates(fabric.id);
    const sodium = scanMods(fabric.id).find((m) => m.projectId === CF.sodium)!;
    const upd = updates.find((u) => u.modId === sodium.id);
    expect(upd, 'обновление не найдено; есть: ' + updates.map((u) => u.modId).join(','));
    await updateMod(fabric.id, sodium.id, upd!.latest);
    const after = scanMods(fabric.id).find((m) => m.projectId === CF.sodium)!;
    expect(after.version !== sodium.version, 'версия не сменилась');
    return `${sodium.version} → ${after.version}`;
  });

  /* ---------------- Экспорт и импорт архива CurseForge ---------------- */
  await step('экспорт для CurseForge (.zip) и установка обратно', async () => {
    const out = path.join(os.tmpdir(), `ploxel-cf-export-${Date.now()}.zip`);
    await exportCurseForgeZip(fabric.id, out);
    const back = await installModpackArchive(out, () => {});
    const a = scanMods(fabric.id).filter((m) => m.kind === 'mod').length;
    const b = scanMods(back.id).filter((m) => m.kind === 'mod').length;
    fs.rmSync(out, { force: true });
    expect(a === b, `модов было ${a}, стало ${b}`);
    return `${back.name}: ${b} модов, ${back.loader.kind} ${back.loader.version ?? ''}`;
  });

  /* ---------------- Модпак из каталога CurseForge ---------------- */
  if (arg('pack') !== '0') {
    await step('модпак Fabulously Optimized из CurseForge', async () => {
      const inst = await installModpackFromProject('curseforge', CF.fabulouslyOptimized);
      const mods = scanMods(inst.id);
      expect(mods.length > 20, 'мало модов: ' + mods.length);
      return `${inst.name} · ${inst.gameVersion} · ${inst.loader.kind} ${inst.loader.version ?? ''} · модов ${mods.length}, вручную ${manualModsCount(inst.id)}`;
    });
  }

  /* ---------------- ИИ ---------------- */
  const { resolveDraft, pickBuild, pickImprove, assemble } = await import('../services/ai-build');
  await step('ИИ-подбор ищет и в CurseForge', async () => {
    const pick = await resolveDraft(
      {
        gameVersion: '1.20.1',
        loader: 'forge',
        mods: ['Waystones', 'Mekanism', 'Just Enough Items', 'Iron Chests', 'Create'].map((name) => ({ name })),
        resourcepacks: [],
        shaders: []
      } as Parameters<typeof resolveDraft>[0],
      '1.20.1'
    );
    const text = pick.items.map((i) => `${i.project.title}[${i.project.source}]`).join(', ');
    expect(pick.items.length >= 4, 'найдено мало: ' + text + '; нет: ' + pick.missing.join(', '));
    return text + (pick.missing.length ? '; не найдено: ' + pick.missing.join(', ') : '');
  });
  await step('ИИ-подбор: чего нет на Modrinth — берётся с CurseForge', async () => {
    const { searchCurseForge } = await import('../services/curseforge');
    // Modrinth «не нашёл» ничего — все проекты должны прийти из CurseForge
    const emptyModrinth = async () => ({ hits: [], total: 0, offset: 0, limit: 6 });
    const pick = await resolveDraft(
      {
        gameVersion: '1.20.1',
        loader: 'forge',
        mods: ['Mystical Agriculture', 'Waystones', 'Just Enough Items'].map((name) => ({ name })),
        resourcepacks: [],
        shaders: []
      } as Parameters<typeof resolveDraft>[0],
      '1.20.1',
      [emptyModrinth, searchCurseForge]
    );
    expect(pick.items.length >= 2 && pick.items.every((i) => i.project.source === 'curseforge'), 'не из CurseForge: ' + JSON.stringify(pick.items.map((i) => i.project.source)));
    const inst = await createInstance({ name: 'CF AI fallback', gameVersion: '1.20.1', loader: { kind: 'forge' } });
    const items = pick.items.map((i) => ({ projectId: i.project.id, source: i.project.source, kind: i.kind, title: i.project.title }));
    const report = await assemble(inst, { name: inst.name, gameVersion: '1.20.1', loader: 'forge', items });
    expect(report.installed === items.length, `установлено ${report.installed}/${items.length}: ${report.failed.join(', ')}`);
    return `${pick.items.map((i) => i.project.title).join(', ')} → установлено ${report.installed}/${items.length}, файлов ${scanMods(inst.id).length}`;
  });
  if (arg('ai') === '1') {
    await step('ИИ-сборка целиком (Forge 1.20.1, техника)', async () => {
      const pick = await pickBuild({ text: 'сборка про технику и механизмы, с картой и JEI', gameVersion: '1.20.1', loader: 'forge', count: '0-20' });
      const items = pick.items.map((i) => ({ projectId: i.project.id, source: i.project.source, kind: i.kind, title: i.project.title, iconUrl: i.project.iconUrl }));
      const inst = await createInstance({ name: 'CF AI', gameVersion: pick.gameVersion, loader: { kind: pick.loader } });
      const report = await assemble(inst, { name: inst.name, gameVersion: pick.gameVersion, loader: pick.loader, items });
      const sources = pick.items.map((i) => i.project.source);
      return `подобрано ${items.length} (CurseForge: ${sources.filter((s) => s === 'curseforge').length}); установлено ${report.installed}/${report.total}; ошибки: ${report.failed.join(', ') || 'нет'}; убрано: ${report.removed.join('; ') || 'нет'}; в сборке ${scanMods(inst.id).length} файлов`;
    });
    await step('«Улучшить с ИИ» не дублирует моды из другого каталога', async () => {
      const pick = await pickImprove(fabric.id, 'добавь Mod Menu, Fabric API, миникарту и мод на оптимизацию');
      const titles = pick.items.map((i) => `${i.project.title}[${i.project.source}]`);
      expect(!pick.items.some((i) => /mod menu|fabric api/i.test(i.project.title)), 'предложен дубль: ' + titles.join(', '));
      const items = pick.items.map((i) => ({ projectId: i.project.id, source: i.project.source, kind: i.kind, title: i.project.title, iconUrl: i.project.iconUrl }));
      const inst = readInstance(fabric.id)!;
      const report = await assemble(inst, { name: inst.name, gameVersion: inst.gameVersion, loader: 'fabric', items }, true);
      return `предложено: ${titles.join(', ')}; отброшено: ${pick.dropped.join('; ') || 'нет'}; установлено ${report.installed}/${report.total}; ошибки: ${report.failed.join(', ') || 'нет'}`;
    });
  }

  console.log(failures ? `[cf] ИТОГ: ошибок ${failures}` : '[cf] ИТОГ: всё прошло');
}
