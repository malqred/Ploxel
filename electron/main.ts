import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc } from './ipc';
import { forgetStoredCurseForgeKey } from './services/curseforge';
import { applyWindowChrome } from './services/chrome';
import { initPaths } from './services/paths';
import { launchInstance } from './services/launcher';
import { loadSettings } from './services/settings';
import { checkForUpdates } from './services/updater';
import { refreshExpiredAccounts } from './services/microsoft';

const isDev = !!process.env.PLOXEL_DEV_SERVER;
const argv = process.argv.slice(1);
const argValue = (name: string) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : '';
};

let win: BrowserWindow | null = null;

// Отдельный профиль для проверок (не мешает запущенному лаунчеру пользователя).
const profileDir = argValue('profile-dir');
if (profileDir) app.setPath('userData', path.resolve(profileDir));

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    const launchArg = argv.find((a) => a.startsWith('--launch-instance='));
    if (launchArg) void launchInstance(launchArg.split('=')[1]).catch((e) => console.error('[launch]', e));
  }
});

export function getMainWindow() {
  return win;
}

function createWindow() {
  const width = Number(argValue('width') || 1440);
  const height = Number(argValue('height') || 900);
  win = new BrowserWindow({
    width,
    height,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#EEE5D6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => win?.show());
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  const screen = argValue('screen');
  if (isDev) {
    const url = `http://localhost:${process.env.PLOXEL_DEV_SERVER}/${screen ? `#/${screen}` : ''}`;
    win.loadURL(url);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), screen ? { hash: `/${screen}` } : undefined);
  }

  // Если процесс страницы упал или завис, окно оставалось пустым (только фон).
  // Записываем причину в лог лаунчера и перезагружаем интерфейс.
  let lastRecover = 0;
  const recover = (why: string) => {
    console.error('[renderer]', why);
    appendFileSafe(path.join(app.getPath('userData'), 'renderer-crashes.log'), `${new Date().toISOString()} ${why}\n`);
    if (!win || win.isDestroyed() || Date.now() - lastRecover < 5000) return;
    lastRecover = Date.now();
    win.webContents.reload();
  };
  win.webContents.on('render-process-gone', (_e, details) => recover(`render-process-gone: ${details.reason} (код ${details.exitCode})`));
  win.on('unresponsive', () => recover('окно не отвечает'));
  if (process.env.PLOXEL_TRACE_NAV) {
    win.webContents.on('did-start-navigation', (d) => console.log('[nav]', d.url, d.isMainFrame));
    win.webContents.on('did-finish-load', () => console.log('[nav] loaded'));
    win.webContents.on('console-message', (d) => console.log('[console]', d.message));
  }

  win.on('closed', () => {
    win = null;
  });

  nativeTheme.on('updated', () => {
    if (win) applyWindowChrome(win);
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.ploxel.launcher');
  await initPaths();
  forgetStoredCurseForgeKey();
  registerIpc();

  const e2e = argValue('e2e');
  if (e2e) {
    const { runE2E } = await import('./dev/e2e');
    try {
      await runE2E(e2e, argValue);
    } catch (err) {
      console.error('[e2e] фатальная ошибка:', err);
    }
    app.exit(0);
    return;
  }

  createWindow();
  const w = win!;
  const shot = argValue('screenshot');
  const evalCode = argValue('evalfile')
    ? fs.readFileSync(argValue('evalfile')!, 'utf8')
    : argValue('eval');

  if (evalCode || shot !== undefined) {
    const run = async () => {
      const wait = Number(argValue('wait') || 1800);
      await new Promise((r) => setTimeout(r, wait));
      if (evalCode) {
        try {
          const result = await w.webContents.executeJavaScript(evalCode);
          console.log('[eval]', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
        } catch (e) {
          console.error('[eval] ошибка:', e);
        }
      }
      if (shot !== undefined) {
        await new Promise((r) => setTimeout(r, 600));
        const target = shot || path.join(process.cwd(), 'screenshots', 'shot.png');
        const image = await w.webContents.capturePage();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, image.toPNG());
        console.log('[screenshot] saved', target);
      }
      app.quit();
    };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => void run());
    else void run();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Запуск сборки ярлыком с рабочего стола
  const launchArg = argValue('launch-instance');
  if (launchArg) {
    setTimeout(() => {
      void launchInstance(launchArg).catch((e) => console.error('[launch]', e instanceof Error ? e.message : e));
    }, 1200);
  }

  // Проверка обновлений лаунчера в фоне
  const settings = loadSettings();
  if (settings.general.autoUpdateLauncher) {
    setTimeout(async () => {
      const info = await checkForUpdates();
      if (info.available && win) win.webContents.send('update:available', info);
    }, 4000);
  }

  // Фоновое продление сессий Microsoft (не блокирует запуск)
  setTimeout(async () => {
    try {
      const refreshed = await refreshExpiredAccounts();
      if (refreshed && win) win.webContents.send('accounts:changed');
    } catch (e) {
      console.warn('[auth] фоновая проверка сессий:', e);
    }
  }, 7000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
function appendFileSafe(file: string, text: string) {
  try {
    fs.appendFileSync(file, text, 'utf8');
  } catch {
    /* журнал не критичен */
  }
}
