// Служебные сценарии для автоматической проверки (не видит пользователь).
// Запуск: electron . --e2e=launch --version=1.21.1 --seconds=120
import { addOfflineAccount, activeAccount } from '../services/accounts';
import { createInstance, listInstances } from '../services/instances';
import { installLoader } from '../services/loaders';
import { launchInstance, stopInstance } from '../services/launcher';
import { appendLog, getLogs } from '../services/logs';
import { ensureVersion } from '../services/versions';
import { downloadJava, ensureJava } from '../services/java';
import { resolveVersion } from '../services/versions';
import { searchModrinth } from '../services/modrinth';
import { installProject, scanMods } from '../services/mods';
import { listLoaderVersions } from '../services/loaders';

export async function runE2E(command: string, arg: (name: string) => string | undefined) {
  const version = arg('version') || '1.21.1';
  const seconds = Number(arg('seconds') || 90);
  console.log(`[e2e] ${command} версия ${version}`);

  if (command === 'content') {
    // Проверка загрузок: моды с зависимостями, ресурспак, шейдер и модпаки (Fabric и Forge)
    const { buildPlan, installPlan } = await import('../services/dependencies');
    const { installModpackFromProject } = await import('../services/modpack');
    const { getModrinthProject } = await import('../services/modrinth');
    const step = async (name: string, fn: () => Promise<string>) => {
      try {
        console.log('[e2e] OK  ', name, '—', await fn());
      } catch (e) {
        console.log('[e2e] FAIL', name, '—', e instanceof Error ? e.message : e);
      }
    };
    const inst = await createInstance({ name: 'E2E content', gameVersion: '1.20.1', loader: { kind: 'fabric', version: '0.16.9' } });
    for (const slug of ['lithium', 'modmenu', 'sodium', 'iris']) {
      await step('мод ' + slug, async () => {
        const project = await getModrinthProject(slug);
        if (!project) throw new Error('проект не найден');
        const plan = await buildPlan(inst, 'modrinth', project.id);
        const keys = plan.items.filter((i) => i.selected || i.required).filter((i) => !i.installed && !i.incompatible).map((i) => i.key);
        const res = await installPlan(inst, plan, keys);
        return 'установлено ' + res.installedKeys.length + ': ' + plan.items.map((i) => i.projectName).join(', ');
      });
    }
    await step('ресурспак faithful-32x', async () => (await installProject(inst, 'modrinth', 'faithful-32x', 'resourcepack')).installed.fileName);
    await step('шейдер complementary-reimagined', async () => (await installProject(inst, 'modrinth', 'complementary-reimagined', 'shader')).installed.fileName);
    console.log('[e2e] файлы сборки:', scanMods(inst.id).map((m) => m.kind + ':' + m.fileName).join(', '));
    for (const slug of (arg('packs') || 'fabulously-optimized,better-mc-forge-bmc4').split(',')) {
      await step('модпак ' + slug, async () => {
        const project = await getModrinthProject(slug);
        if (!project) throw new Error('проект не найден');
        const pack = await installModpackFromProject('modrinth', project.id);
        return pack.name + ' · ' + pack.gameVersion + ' · ' + pack.loader.kind + ' ' + (pack.loader.version ?? '') + ' · модов ' + scanMods(pack.id).length;
      });
    }
    return;
  }

  if (command === 'curseforge') {
    const { runCurseForgeE2E } = await import('./e2e-curseforge');
    await runCurseForgeE2E(arg);
    return;
  }

  if (command === 'java') {
    const java = await downloadJava(arg('component') || 'java-runtime-gamma', (d, t) => printProgress('java', d, t));
    console.log('[e2e] java скачана:', java.path, 'major', java.major);
    return;
  }

  if (command === 'download') {
    const { json } = await resolveVersion(version);
    const java = await ensureJava(json, { allowDownload: true, onProgress: (d, t) => printProgress('java', d, t) });
    console.log('[e2e] java', java.java.path, java.java.major);
    await ensureVersion(version, {
      ctx: { os: 'windows', arch: 'x86_64', features: {} },
      onProgress: (d, t, phase) => printProgress(phase, d, t)
    });
    console.log('[e2e] файлы игры готовы');
    return;
  }

  if (command === 'mods') {
    const loaders = await listLoaderVersions('fabric', version);
    const loaderVersion = loaders.versions[0];
    if (!loaderVersion) throw new Error('Нет версий Fabric');
    let inst = listInstances().find((i) => i.loader.kind === 'fabric' && i.gameVersion === version);
    if (!inst) {
      inst = await createInstance({
        name: `Fabric ${version}`,
        gameVersion: version,
        loader: { kind: 'fabric', version: loaderVersion }
      });
    }
    await installLoader(version, 'fabric', loaderVersion, (l) => console.log('[loader]', l));
    const res = await searchModrinth({
      source: 'modrinth',
      projectType: 'mod',
      query: 'sodium',
      gameVersion: version,
      loader: 'fabric',
      sort: 'downloads',
      offset: 0,
      limit: 5
    });
    const project = res.hits[0];
    console.log('[e2e] проект:', project.title, project.id);
    const out = await installProject(inst, 'modrinth', project.id, 'mod', { projectName: project.title });
    console.log('[e2e] установлено:', out.installed.fileName, 'зависимостей:', out.dependencies.length, 'пропущено:', out.skipped);
    console.log('[e2e] моды:', scanMods(inst.id).map((m) => m.fileName).join(', '));
    return;
  }

  if (command !== 'launch') return;

  if (!activeAccount()) addOfflineAccount('Tester');
  const wantLoader = arg('loader');
  let instance = listInstances().find(
    (i) =>
      (arg('instance') ? i.id === arg('instance') : true) && i.gameVersion === version && (wantLoader ? i.loader.kind === wantLoader : i.loader.kind === 'vanilla')
  );
  if (!instance) {
    // С --loader сборка создаётся без версии загрузчика и без его файлов — как после
    // импорта из другого лаунчера: запуск сам выберет версию и установит загрузчик
    const kind = (wantLoader as 'fabric' | 'quilt' | 'forge' | 'neoforge' | undefined) ?? 'vanilla';
    instance = await createInstance({ name: `E2E ${version}`, gameVersion: version, loader: { kind } });
  }

  let success = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const lines = getLogs(instance!.id);
    if (lines.some((l) => /Sound engine started|Backend library: LWJGL/.test(l.line))) success = true;
  }, 1500);

  try {
    await launchInstance(instance.id);
  } catch (e) {
    console.error('[e2e] ошибка запуска:', e);
    clearInterval(timer);
    return;
  }

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const lines = getLogs(instance!.id);
      if (lines.some((l) => /Sound engine started|Backend library: LWJGL/.test(l.line))) success = true;
      if (lines.some((l) => /Игра завершилась/.test(l.line)) || elapsed > seconds) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });

  clearInterval(timer);
  await stopInstance(instance.id);
  await new Promise((r) => setTimeout(r, 2500));
  const lines = getLogs(instance.id);
  console.log('[e2e] строк лога:', lines.length);
  console.log('[e2e] последние строки:');
  for (const l of lines.slice(-25)) console.log('   ', l.line);
  console.log('[e2e] УСПЕХ:', success);
  appendLog(instance.id, `E2E: ${success ? 'успех' : 'провал'}`, 'launcher');
}

let lastPhase = '';
let lastPct = -1;
function printProgress(phase: string, done: number, total: number) {
  const pct = total ? Math.floor((done / total) * 100) : 0;
  if (phase !== lastPhase || pct >= lastPct + 10) {
    lastPhase = phase;
    lastPct = pct;
    console.log(`[e2e] ${phase}: ${done}/${total} (${pct}%)`);
  }
}
