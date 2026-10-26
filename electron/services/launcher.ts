import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { data, instanceDir } from './paths';
import { readInstance, updateInstance } from './instances';
import { recordSession } from './playtime';
import { activeAccount, getStoredAccount } from './accounts';
import { getMinecraftToken } from './microsoft';
import { ensureLoader } from './loaders';
import { ensureVersion, resolveVersion } from './versions';
import { ensureJava, javaFits, readMajor } from './java';
import { loadSettings } from './settings';
import { buildCommand, buildLaunchPlan } from '../core/version/launch';
import { compareVersions } from '../core/version-compare';
import { appendLog, startNewSessionLog } from './logs';
import { createTask, finishTask, updateTask } from './downloader';
import { emit } from './events';
import type { Instance, LogLine } from '../../shared/types';

const running = new Map<string, ChildProcess>();
const controllers = new Map<string, AbortController>();
let currentLaunchInstance: string | null = null;

/** Отмена загрузки/подготовки запуска по id задачи. */
export function cancelTask(taskId: string): boolean {
  const ctrl = controllers.get(taskId);
  if (!ctrl) return false;
  ctrl.abort();
  controllers.delete(taskId);
  return true;
}

export function isGameRunning(instanceId?: string): boolean {
  if (instanceId) return running.has(instanceId);
  return running.size > 0;
}

export function getRunningInstance(): string | null {
  return currentLaunchInstance;
}

export interface LaunchOptions {
  quickPlayServer?: string;
  quickPlayWorld?: string;
}

export async function launchInstance(instanceId: string, options: LaunchOptions = {}): Promise<{ pid?: number }> {
  const instance = readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  if (running.has(instanceId)) throw new Error('Эта сборка уже запущена');

  const account = activeAccount();
  if (!account) throw new Error('Сначала войдите в аккаунт или создайте офлайн-профиль в Настройках');
  const stored = getStoredAccount(account.id);
  if (!stored) throw new Error('Аккаунт не найден');

  const settings = loadSettings();
  const taskId = createTask(`Запуск «${instance.name}»`, 'Подготовка');
  const controller = new AbortController();
  controllers.set(taskId, controller);
  startNewSessionLog(instanceId);
  const log = (text: string, stream: LogLine['stream'] = 'launcher') => appendLog(instanceId, text, stream);

  try {
    const token = await getMinecraftToken(account.id);
    updateTask(taskId, { detail: 'Проверка загрузчика' });
    const prepared = await ensureLoader(instance.gameVersion, instance.loader, (line) => log(line));
    if (prepared.changed) await updateInstance(instance.id, { loader: prepared.loader });
    const versionId = prepared.versionId;
    log(`Версия: ${versionId}`);

    const { json } = await resolveVersion(versionId);

    // Java: у сборки может быть свой выбранный путь
    updateTask(taskId, { detail: 'Проверка Java' });
    let javaPath: string;
    const required = json.javaVersion?.majorVersion ?? 8;
    const chosenMajor = instance.javaPath && fs.existsSync(instance.javaPath) ? await readMajor(instance.javaPath) : null;
    if (instance.javaPath && chosenMajor !== null && javaFits(chosenMajor, required)) {
      javaPath = instance.javaPath;
      log(`Java (выбрана для сборки): ${javaPath}`);
    } else {
      if (instance.javaPath) {
        log(`Выбранная Java ${chosenMajor ?? '?'} не подходит для этой версии игры (нужна Java ${required}) — берём подходящую`, 'launcher');
      }
      const java = await ensureJava(json, {
        allowDownload: settings.java.autoDownloadJava,
        onProgress: (done, total) => updateTask(taskId, { detail: 'Загрузка Java', done, total })
      });
      javaPath = java.java.path;
      log(`Java ${java.java.major}: ${javaPath}`);
    }

    // Файлы игры + ассеты
    updateTask(taskId, { detail: 'Проверка файлов игры', done: 0, total: 0 });
    const install = await ensureVersion(versionId, {
      ctx: {
        os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux',
        arch: process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : 'x86',
        features: {}
      },
      signal: controller.signal,
      onProgress: (done, total, phase) => updateTask(taskId, { detail: phase, done, total })
    });

    const gameDir = instanceDir(instanceId);
    const memory = instance.memoryMb ?? settings.general.memoryMb ?? 4096;
    const supportsQuickPlay = compareVersions(instance.gameVersion, '1.20') >= 0;
    const quickServer = supportsQuickPlay ? (options.quickPlayServer ?? instance.serverAddress) : undefined;
    const quickWorld = supportsQuickPlay ? options.quickPlayWorld : undefined;
    const plan = buildLaunchPlan({
      version: install.json,
      ctx: {
        os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux',
        arch: process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : 'x86',
        features: {}
      },
      classpath: install.classpath,
      nativesDir: install.nativesDir,
      librariesDir: data('libraries'),
      assetsRoot: install.assetsRoot,
      assetIndex: install.assetIndexId,
      gameDir,
      versionName: versionId,
      versionType: install.json.type ?? 'release',
      playerName: token.name,
      uuid: token.uuid,
      accessToken: account.type === 'offline' ? '0'.repeat(32) : token.accessToken,
      userType: account.type === 'offline' ? 'legacy' : 'msa',
      memoryMb: memory,
      extraJvmArgs: instance.jvmArgs ?? settings.java.jvmArgs,
      launcherVersion: '0.1.0',
      isOffline: account.type === 'offline',
      logConfigPath: install.logConfig,
      quickPlayMultiplayer: quickServer,
      quickPlaySingleplayer: quickWorld
    });

    const command = buildCommand(javaPath, plan);
    log(`Запуск: ${javaPath} ${plan.jvm.join(' ')} ${plan.mainClass}`);
    updateTask(taskId, { done: 1, total: 1, detail: 'Запуск игры' });

    const child = spawn(command[0], command.slice(1), {
      cwd: gameDir,
      windowsHide: true,
      env: { ...process.env }
    });
    running.set(instanceId, child);
    currentLaunchInstance = instanceId;
    emit('game:started', { instanceId, pid: child.pid });
    await updateInstance(instanceId, { lastPlayedAt: new Date().toISOString() });

    let outBuffer = '';
    const onChunk = (chunk: Buffer) => {
      outBuffer += chunk.toString('utf8');
      const parts = outBuffer.split(/\r?\n/);
      outBuffer = parts.pop() ?? '';
      for (const line of parts) if (line.length) appendLog(instanceId, line, 'out');
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', (c: Buffer) => {
      const text = c.toString('utf8');
      for (const line of text.split(/\r?\n/)) if (line.trim()) appendLog(instanceId, line, 'err');
    });

    child.on('error', (err) => {
      appendLog(instanceId, `Ошибка процесса: ${err.message}`, 'launcher');
      running.delete(instanceId);
      currentLaunchInstance = null;
      emit('game:exited', { instanceId, code: -1, crashed: true });
    });

    child.on('close', async (code) => {
      running.delete(instanceId);
      if (currentLaunchInstance === instanceId) currentLaunchInstance = null;
      const crashed = code !== 0 && code !== null;
      appendLog(instanceId, `Игра завершилась (код ${code ?? 'н/д'})`, 'launcher');
      emit('game:exited', { instanceId, code, crashed });
      const current = readInstance(instanceId);
      if (current?.lastPlayedAt) {
        const minutes = Math.max(1, Math.round((Date.now() - new Date(current.lastPlayedAt).getTime()) / 60000));
        await updateInstance(instanceId, { playtimeMinutes: (current.playtimeMinutes ?? 0) + minutes });
        try {
          recordSession(instanceId, new Date(current.lastPlayedAt), new Date());
        } catch (e) {
          console.warn('[playtime] не удалось записать сессию', e);
        }
      }
    });

    finishTask(taskId);
    controllers.delete(taskId);
    applyWindowBehavior(settings.general.closeLauncherOnGameStart);
    return { pid: child.pid };
  } catch (e) {
    controllers.delete(taskId);
    const message = e instanceof Error ? e.message : String(e);
    appendLog(instanceId, message, 'launcher');
    finishTask(taskId, message);
    emit('launch:failed', { instanceId, message });
    throw e;
  }
}

function applyWindowBehavior(behavior: 'keep' | 'minimize' | 'close') {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (behavior === 'minimize') win.minimize();
  if (behavior === 'close') win.close();
}

export async function stopInstance(instanceId: string): Promise<void> {
  const child = running.get(instanceId);
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
  appendLog(instanceId, 'Игра остановлена пользователем', 'launcher');
}

export function listRunning(): string[] {
  return [...running.keys()];
}

export type { Instance };