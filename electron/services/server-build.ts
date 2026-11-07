import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInstance, readInstance, updateInstance } from './instances';
import { instanceDir, data } from './paths';
import { contentDir, scanMods } from './mods';
import { modrinthServerSides } from './modrinth';
import { listLoaderVersions, readInstallerPlan } from './loaders';
import { resolveVersion } from './versions';
import { ensureJava } from './java';
import { createTask, downloadMany, fetchJson, finishTask, updateTask } from './downloader';
import { launchCommandOutsideApp } from './detached';
import { openZipLite } from '../core/zip-lite';
import type { Instance } from '../../shared/types';

/**
 * «Сделать сервер из сборки»: отдельная сборка-сервер рядом с исходной (та не меняется).
 * В неё кладутся серверный jar игры и загрузчика, моды, которые нужны серверу
 * (только клиентские — шейдеры, миникарты, оптимизация отрисовки — не нужны и часто
 * роняют сервер), настройки и, по желанию, мир. Остаётся запустить start.bat.
 */

export type ServerSide = 'server' | 'client' | 'unknown';

export interface ServerPlanItem {
  name: string;
  fileName: string;
  side: ServerSide;
}

export interface ServerPlan {
  items: ServerPlanItem[];
  worlds: string[];
  loader: Instance['loader']['kind'];
  gameVersion: string;
}

const KEEP_DIRS = ['config', 'defaultconfigs', 'kubejs', 'scripts', 'global_packs', 'paxi'];

/** Сторона мода по самому jar: Fabric/Quilt пишут environment, NeoForge/Forge — clientSideOnly. */
export function jarSide(file: string): ServerSide {
  try {
    const zip = openZipLite(file);
    try {
      const read = (name: string) => {
        const e = zip.entries.find((x) => x.name === name);
        return e ? zip.read(e).toString('utf8') : null;
      };
      const fabric = read('fabric.mod.json') ?? read('quilt.mod.json');
      if (fabric) {
        const env = (JSON.parse(fabric).environment ?? JSON.parse(fabric).quilt_loader?.minecraft?.environment) as string | undefined;
        if (env === 'client') return 'client';
        if (env === 'server' || env === '*' || env === 'dedicated_server') return 'server';
      }
      const toml = read('META-INF/neoforge.mods.toml') ?? read('META-INF/mods.toml');
      if (toml && /^\s*clientSideOnly\s*=\s*true/m.test(toml)) return 'client';
    } finally {
      zip.close();
    }
  } catch {
    /* не jar или повреждён */
  }
  return 'unknown';
}

/** Какие моды пойдут на сервер. Ничего не меняет. */
export async function planServer(instanceId: string): Promise<ServerPlan> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const dir = contentDir(instanceId, 'mod');
  const mods = scanMods(instanceId).filter((m) => m.kind === 'mod' && m.enabled);
  const hashes = new Map<string, string>();
  for (const m of mods) {
    try {
      hashes.set(m.fileName, crypto.createHash('sha1').update(await fsp.readFile(path.join(dir, m.fileName))).digest('hex'));
    } catch {
      /* файл пропал */
    }
  }
  const sides = await modrinthServerSides([...hashes.values()]).catch(() => ({} as Record<string, string>));
  const items = mods.map((m) => {
    const side = sides[hashes.get(m.fileName) ?? ''];
    let s: ServerSide = side === 'unsupported' ? 'client' : side === 'required' || side === 'optional' ? 'server' : 'unknown';
    if (s === 'unknown') s = jarSide(path.join(dir, m.fileName));
    return { name: m.name || m.fileName, fileName: m.fileName, side: s };
  });
  let worlds: string[] = [];
  try {
    worlds = fs.readdirSync(path.join(instanceDir(instanceId), 'saves'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* миров нет */
  }
  return { items, worlds, loader: instance.loader.kind, gameVersion: instance.gameVersion };
}

export interface ServerOptions {
  /** папка мира в saves исходной сборки; пусто — сервер создаст новый мир */
  world?: string;
  /** пользователь принял EULA Minecraft — без этого сервер не запустится */
  eula: boolean;
  /** пускать игроков без лицензии (online-mode=false) */
  offlinePlayers?: boolean;
  memoryMb?: number;
}

/** Создать сборку-сервер. Идёт фоновой задачей в «Загрузках». */
export async function createServer(instanceId: string, opts: ServerOptions): Promise<Instance> {
  const source = readInstance(instanceId);
  if (!source) throw new Error('Сборка не найдена');
  const taskId = createTask(`Сервер из «${source.name}»`, 'Проверка модов');
  updateTask(taskId, { status: 'running', total: 100, done: 2 });
  let created: Instance | null = null;
  try {
    const plan = await planServer(instanceId);
    const loader = source.loader.kind;
    let loaderVersion = source.loader.version;
    if (loader !== 'vanilla' && !loaderVersion) {
      loaderVersion = (await listLoaderVersions(loader, source.gameVersion)).versions[0];
      if (!loaderVersion) throw new Error(`Не удалось узнать версию ${loader} для ${source.gameVersion}`);
    }
    created = await createInstance({
      name: `${source.name} — сервер`,
      gameVersion: source.gameVersion,
      loader: { kind: loader, version: loaderVersion },
      memoryMb: opts.memoryMb ?? source.memoryMb,
      iconHue: source.iconHue
    });
    created = (await updateInstance(created.id, { server: true, serverOf: source.id })) ?? created;
    const root = instanceDir(created.id);
    const memory = opts.memoryMb ?? source.memoryMb ?? 4096;

    // Моды и настройки
    updateTask(taskId, { detail: 'Копирование модов и настроек', done: 8 });
    const modsTo = path.join(root, 'mods');
    await fsp.mkdir(modsTo, { recursive: true });
    for (const item of plan.items.filter((i) => i.side !== 'client')) {
      await fsp.copyFile(path.join(contentDir(instanceId, 'mod'), item.fileName), path.join(modsTo, item.fileName)).catch(() => undefined);
    }
    for (const sub of KEEP_DIRS) {
      const from = path.join(instanceDir(instanceId), sub);
      if (fs.existsSync(from)) await fsp.cp(from, path.join(root, sub), { recursive: true, force: true });
    }
    if (opts.world) {
      updateTask(taskId, { detail: 'Копирование мира', done: 14 });
      await fsp.cp(path.join(instanceDir(instanceId), 'saves', opts.world), path.join(root, 'world'), { recursive: true });
    }

    // Java той версии, что нужна игре
    updateTask(taskId, { detail: 'Проверка Java', done: 18 });
    const { json } = await resolveVersion(source.gameVersion);
    const java = (await ensureJava(json, { allowDownload: true, onProgress: () => {} })).java.path;

    // Серверный jar игры
    const serverJar = json.downloads?.server;
    if (!serverJar?.url) throw new Error(`У Minecraft ${source.gameVersion} нет официального сервера`);
    updateTask(taskId, { detail: 'Сервер Minecraft', done: 25 });
    await downloadMany([{ url: serverJar.url, dest: path.join(root, 'server.jar'), sha1: serverJar.sha1, size: serverJar.size }], { onProgress: () => {} });

    // Загрузчик
    let launchJar = 'server.jar';
    let useRunBat = false;
    if (loader === 'fabric') {
      updateTask(taskId, { detail: 'Сервер Fabric', done: 45 });
      const installers = await fetchJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/installer');
      const inst = installers.find((i) => i.stable) ?? installers[0];
      await downloadMany(
        [{ url: `https://meta.fabricmc.net/v2/versions/loader/${source.gameVersion}/${loaderVersion}/${inst.version}/server/jar`, dest: path.join(root, 'fabric-server-launch.jar') }],
        { onProgress: () => {} }
      );
      launchJar = 'fabric-server-launch.jar';
    } else if (loader === 'quilt') {
      updateTask(taskId, { detail: 'Сервер Quilt', done: 45 });
      const installers = await fetchJson<{ version: string; url: string }[]>('https://meta.quiltmc.org/v3/versions/installer');
      const installer = data('installers', `quilt-installer-${installers[0].version}.jar`);
      await downloadMany([{ url: installers[0].url, dest: installer }], { onProgress: () => {} });
      await run(java, ['-jar', installer, 'install', 'server', source.gameVersion, loaderVersion!, `--install-dir=${root}`], root);
      launchJar = 'quilt-server-launch.jar';
    } else if (loader === 'forge' || loader === 'neoforge') {
      // Названия этапов — целыми строками, чтобы их переводил словарь интерфейса
      const phase =
        loader === 'forge'
          ? { start: 'Сервер Forge', libs: 'Сервер Forge — библиотеки', install: 'Сервер Forge — установка' }
          : { start: 'Сервер NeoForge', libs: 'Сервер NeoForge — библиотеки', install: 'Сервер NeoForge — установка' };
      updateTask(taskId, { detail: phase.start, done: 45 });
      const url =
        loader === 'neoforge'
          ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
          : `https://maven.minecraftforge.net/net/minecraftforge/forge/${source.gameVersion}-${loaderVersion}/forge-${source.gameVersion}-${loaderVersion}-installer.jar`;
      const installer = data('installers', `${loader}-${loaderVersion}.jar`);
      if (!fs.existsSync(installer)) await downloadMany([{ url, dest: installer }], { onProgress: () => {} });
      // Библиотеки — сами и параллельно: установщик Forge берёт их по одной через медленное зеркало
      const plan = readInstallerPlan(installer);
      await downloadMany(
        plan.libraries.map((l) => ({ url: l.url, dest: path.join(root, 'libraries', l.path), sha1: l.sha1, size: l.size })),
        { onProgress: (d, t) => updateTask(taskId, { detail: `${phase.libs}: ${d} из ${t}`, done: 45 + Math.round((d / Math.max(1, t)) * 20) }) }
      ).catch(() => undefined);
      updateTask(taskId, { detail: phase.install, done: 66 });
      await run(java, ['-jar', installer, '--installServer', root], root);
      if (fs.existsSync(path.join(root, 'run.bat'))) useRunBat = true;
      else {
        // Forge до 1.17: рядом появляется forge-<версия>.jar, его и запускаем
        const jar = fs.readdirSync(root).find((f) => /^(forge|neoforge)-.*\.jar$/i.test(f) && !/installer/i.test(f));
        if (!jar) throw new Error('Установщик сервера Forge не создал файл запуска');
        launchJar = jar;
      }
    }

    // Запуск, EULA, настройки сервера
    updateTask(taskId, { detail: 'Файлы запуска', done: 92 });
    const javaBin = path.dirname(java);
    // chcp 65001: файл в UTF-8 — иначе русские буквы в пути и названии ломаются
    const lines = ['@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"', `title ${created.name.replace(/[&|<>^%]/g, '')}`];
    if (useRunBat) {
      await fsp.appendFile(path.join(root, 'user_jvm_args.txt'), `\r\n-Xmx${memory}M\r\n`, 'utf8');
      lines.push(`set "PATH=${javaBin};%PATH%"`, 'call run.bat nogui');
    } else {
      lines.push(`"${java}" -Xmx${memory}M -Xms${Math.min(1024, memory)}M -jar ${launchJar} nogui`, 'pause');
    }
    await fsp.writeFile(path.join(root, 'start.bat'), lines.join('\r\n') + '\r\n', 'utf8');
    if (opts.eula) await fsp.writeFile(path.join(root, 'eula.txt'), '# Принято в Ploxel: https://aka.ms/MinecraftEULA\r\neula=true\r\n', 'utf8');
    // server.properties — формат Java: не-латинские буквы записываются как \uXXXX
    const escapeProp = (v: string) => v.replace(/[\r\n]/g, ' ').replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const props = [`motd=${escapeProp(created.name)}`];
    if (opts.world) props.push('level-name=world');
    if (opts.offlinePlayers) props.push('online-mode=false');
    await fsp.writeFile(path.join(root, 'server.properties'), props.join('\r\n') + '\r\n', 'utf8');

    finishTask(taskId);
    return readInstance(created.id) ?? created;
  } catch (e) {
    finishTask(taskId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

function run(java: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd, windowsHide: true });
    let tail = '';
    const keep = (b: Buffer) => {
      tail = (tail + b.toString('utf8')).slice(-600);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Установщик сервера завершился с кодом ${code}. ${tail}`))));
  });
}

/** Запустить сервер в своём окне консоли — он переживёт закрытие лаунчера. */
export function startServer(instance: Instance): void {
  const bat = path.join(instanceDir(instance.id), 'start.bat');
  if (!fs.existsSync(bat)) throw new Error('В папке сервера нет start.bat — пересоздайте сервер из сборки.');
  // У start первый аргумент в кавычках — заголовок окна; без них Windows искала бы программу «Ploxel»
  launchCommandOutsideApp(`cmd.exe /c start "Ploxel" "${bat}"`);
}
