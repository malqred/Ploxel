import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { getConfig } from './services/config';
import { applyWindowChrome } from './services/chrome';
import { getRoot, listDrives, setRoot } from './services/paths';
import { measureTree, moveDataRoot, MoveCancelled } from './services/root-move';
import { loadSettings, replaceKeybinds, resetSettings, saveSettings } from './services/settings';
import * as instances from './services/instances';
import { applyKeybindsOnCreate, keybindsFor } from './services/keybinds';
import * as accounts from './services/accounts';
import * as microsoft from './services/microsoft';
import { getJavaNews, getNews, getPatchNote, getPatchNotes } from './services/news';
import { setBroadcaster } from './services/events';
import { listVersions, isVersionInstalled } from './services/versions';
import { installLoader, listLoaderVersions, versionIdFor } from './services/loaders';
import { detectJava, ensureJava, recommendJava, downloadJava } from './services/java';
import { launchInstance, stopInstance, listRunning } from './services/launcher';
import { getLogs, clearLogs, exportLog } from './services/logs';
import {
  getTasks,
  downloadFile,
  configureDownloader,
  getDownloadStats,
  pauseTask,
  resumeTask,
  cancelTask as cancelDownloadTask
} from './services/downloader';
import { loadSettings as readSettings } from './services/settings';
import { searchCatalog, catalogVersions, catalogProject, isCurseForgeAvailable } from './services/catalog';
import * as mods from './services/mods';
import { memoryAdviceFor } from './services/memory-advice';
import { installModpackFromProject, installModpackFileWithTask, exportMrpack, exportCurseForgeZip, manualModsCount } from './services/modpack';
import { analyzeLog, aiAvailable, sanitizeLog, testAi, chat } from './services/ai';
import { pickBuild, pickImprove, startAssemble, startImprove, type AiPickInput, type AssembleItem, type AssembleSpec } from './services/ai-build';
import { getModrinthProjectBriefs } from './services/modrinth';
import { checkForUpdates, downloadAndRunUpdate } from './services/updater';
import { translatePage, translateText } from './services/translate';
import { weekSummary } from './services/playtime';
import { analyzeCrash, applyCrashFixes, rollbackCrashBackup } from './services/crash-analyzer';
import { buildPlan, installPlan, checkBuild, planAutoFix } from './services/dependencies';
import type { DependencyPlan } from '../shared/types';
import {
  detectLaunchers,
  importDetected,
  deleteImportedSource,
  importArchive,
  detectArchiveFormat,
  matchMods
} from './services/launcher-import';
import type { CrashCause } from '../shared/types';
import { listWorlds, importWorld, exportWorld, worldFolder } from './services/worlds';
import { clearBackgrounds, pickBackground } from './services/local-media';
import * as screenshots from './services/screenshots';
import { loginElyBy, signOutElyBy } from './services/elyby';
import { importMinecraftFolder } from './services/minecraft-import';
import fsSync from 'node:fs';
import * as skins from './services/skins';
import type { SkinLayers } from '../shared/types';
import { setSecret, hasSecret, deleteSecret } from './services/secrets';
import { exportAppearance, importAppearance } from './services/appearance-io';
import { uninstallLauncher } from './services/uninstall';
import type { CatalogSearchQuery, InstalledMod } from '../shared/types';
import type { AppInfo, Instance, LoaderSpec, Settings, ThemeId } from '../shared/types';

type Handler = (...args: never[]) => unknown;

/** Перенос папки данных может идти долго — его можно отменить. */
let moveController: AbortController | null = null;

function handle(channel: string, fn: Handler) {
  ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
}

export function broadcast(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

export function registerIpc(): void {
  setBroadcaster(broadcast);
  configureDownloader(loadSettings().downloads);
  handle('settings:get', () => loadSettings());
  handle('settings:set', (patch: Partial<Settings>) => {
    const next = saveSettings(patch);
    configureDownloader(next.downloads);
    broadcast('settings:changed', next);
    return next;
  });
  handle('settings:setKeybinds', (keybinds: Record<string, string>) => {
    const next = replaceKeybinds(keybinds ?? {});
    broadcast('settings:changed', next);
    return next;
  });
  handle('settings:reset', () => {
    const next = resetSettings();
    broadcast('settings:changed', next);
    return next;
  });

  // Память компьютера сейчас — для полоски над ползунком памяти
  handle('system:memory', () => ({ totalMb: Math.round(os.totalmem() / 1048576), freeMb: Math.round(os.freemem() / 1048576) }));
  handle('app:info', (): AppInfo => {
    const cfg = getConfig();
    return {
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      dataRoot: getRoot(),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      config: {
        microsoftClientId: !!cfg.microsoftClientId || hasSecret('ms-client-id'),
        curseforgeKey: !!cfg.curseforgeApiKey,
        aiKey: !!cfg.aiApiKey || hasSecret('ai-key')
      },
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      systemAnimations: true
    };
  });

  handle('app:uninstall', (options: { deleteInstances?: boolean; deleteAllData?: boolean }) => {
    const result = uninstallLauncher(options ?? {});
    // Даём ответу дойти до окна, закрываемся и уступаем место деинсталлятору.
    setTimeout(() => app.quit(), 400);
    return result;
  });

  handle('app:chrome', (theme: ThemeId, dark?: boolean) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) applyWindowChrome(win, theme, dark);
  });

  handle('dialog:folder', async (title: string) => {
    const res = await dialog.showOpenDialog({
      title,
      properties: ['openDirectory', 'createDirectory']
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('dialog:file', async (title: string, filters: { name: string; extensions: string[] }[]) => {
    const res = await dialog.showOpenDialog({ title, properties: ['openFile'], filters });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('dialog:files', async (title: string, filters: { name: string; extensions: string[] }[]) => {
    const res = await dialog.showOpenDialog({ title, properties: ['openFile', 'multiSelections'], filters });
    return res.canceled ? [] : res.filePaths;
  });
  handle('dialog:save', async (title: string, defaultPath: string, filters: { name: string; extensions: string[] }[]) => {
    const res = await dialog.showSaveDialog({ title, defaultPath, filters });
    return res.canceled ? null : res.filePath;
  });

  handle('shell:openPath', async (target: string) => shell.openPath(target));
  handle('appearance:pickBackground', () => pickBackground(BrowserWindow.getFocusedWindow()));
  handle('appearance:clearBackground', () => clearBackgrounds());
  handle('screenshots:list', (instanceId: string) => screenshots.listScreenshots(instanceId));
  handle('screenshots:saveAs', (instanceId: string, file: string) => screenshots.saveScreenshotAs(instanceId, file));
  handle('screenshots:show', (instanceId: string, file: string) => screenshots.showScreenshotInFolder(instanceId, file));
  handle('screenshots:delete', (instanceId: string, file: string) => screenshots.deleteScreenshot(instanceId, file));
  handle('shell:openExternal', async (url: string) => {
    if (/^https:\/\//.test(url)) await shell.openExternal(url);
  });
  handle('shell:showItem', (target: string) => shell.showItemInFolder(target));

  handle('paths:root', () => getRoot());
  handle('paths:setRoot', async (next: string) => {
    setRoot(path.resolve(next));
    broadcast('paths:changed', getRoot());
    return getRoot();
  });
  handle('paths:drives', () => listDrives());
  handle('paths:usage', async () => measureTree(getRoot()));
  handle('paths:moveRoot', async (next: string, deleteOld = true) => {
    if (moveController) throw new Error('Перенос уже идёт');
    moveController = new AbortController();
    try {
      const result = await moveDataRoot(next, {
        deleteOld: deleteOld !== false,
        signal: moveController.signal,
        onProgress: (p) => broadcast('paths:moveProgress', p)
      });
      broadcast('paths:changed', result.root);
      broadcast('settings:changed', loadSettings());
      return result;
    } catch (e) {
      if (e instanceof MoveCancelled) throw new Error('Перенос отменён. Данные на старом месте не тронуты.');
      throw e;
    } finally {
      moveController = null;
    }
  });
  handle('paths:cancelMove', () => {
    moveController?.abort();
    return true;
  });
  handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });

  handle('window:minimize', () => BrowserWindow.getAllWindows()[0]?.minimize());
  handle('window:maximize', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('window:close', () => BrowserWindow.getAllWindows()[0]?.close());
  handle('window:isMaximized', () => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false);

  /* ------------------------------ Сборки ------------------------------ */

  handle('instances:list', () => instances.listInstances());
  handle('instances:create', async (input: { name: string; gameVersion: string; loader: LoaderSpec; memoryMb?: number; javaPath?: string }) => {
    const instance = await instances.createInstance(input);
    // Общее управление применяется один раз — при создании сборки.
    applyKeybindsOnCreate(instance.id, instance.gameVersion);
    return instance;
  });
  handle('instances:keybindsFor', (gameVersion: string) => keybindsFor(gameVersion));
  handle('instances:update', (id: string, patch: Partial<Instance>) => instances.updateInstance(id, patch));
  handle('instances:delete', (id: string) => instances.deleteInstance(id));
  handle('instances:duplicate', (id: string) => instances.duplicateInstance(id));
  handle('instances:folder', async (id: string, sub?: string) => {
    let dir = await instances.openInstanceFolder(id);
    // Только известные подпапки сборки (например, снимки)
    if (sub === 'screenshots') {
      dir = path.join(dir, sub);
      await fsp.mkdir(dir, { recursive: true });
    }
    await shell.openPath(dir);
    return dir;
  });
  handle('instances:path', (id: string) => instances.openInstanceFolder(id));
  handle('instances:worldCount', (id: string) => instances.countWorlds(id));
  handle('instances:setCover', async (id: string) => {
    const res = await dialog.showOpenDialog({
      title: 'Обложка сборки',
      filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return instances.setInstanceCover(id, res.filePaths[0]);
  });
  handle('instances:removeCover', (id: string) => instances.removeInstanceCover(id));
  handle('instance:shortcut', async (id: string) => {
    const inst = instances.readInstance(id);
    if (!inst) throw new Error('Сборка не найдена');
    const desktop = app.getPath('desktop');
    const link = path.join(desktop, `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}.lnk`);
    const args = app.isPackaged ? `--launch-instance=${id}` : `"${app.getAppPath()}" --launch-instance=${id}`;
    const ok = shell.writeShortcutLink(link, 'create', {
      target: process.execPath,
      args,
      description: `Запустить сборку ${inst.name} в Ploxel`,
      icon: process.execPath,
      iconIndex: 0,
      cwd: app.getAppPath()
    });
    if (!ok) throw new Error('Windows не дал создать ярлык');
    return link;
  });
  handle('instances:mods', (id: string) => mods.scanMods(id));
  handle('instances:memoryAdvice', (id: string) => memoryAdviceFor(id));

  /* ------------------------------ Аккаунты ------------------------------ */

  handle('accounts:list', () => accounts.listAccounts());
  handle('accounts:views', () => accounts.listAccountViews());
  handle('accounts:active', () => accounts.activeAccount());
  handle('accounts:addOffline', (name: string) => {
    const acc = accounts.addOfflineAccount(name);
    broadcast('accounts:changed');
    return acc;
  });
  handle('accounts:remove', async (id: string) => {
    if (accounts.getStoredAccount(id)?.type === 'elyby') await signOutElyBy(id);
    const list = accounts.removeAccount(id);
    broadcast('accounts:changed');
    return list;
  });
  handle('accounts:setActive', (id: string) => {
    const acc = accounts.setActiveAccount(id);
    broadcast('accounts:changed');
    return acc;
  });
  handle('accounts:refreshAll', async () => {
    const count = await microsoft.refreshExpiredAccounts();
    broadcast('accounts:changed');
    return count;
  });
  handle('auth:ms:start', () => microsoft.startDeviceLogin());
  // Ely.by: пароль только передаётся на authserver.ely.by и нигде не сохраняется
  handle('auth:ely:login', async (login: string, password: string, totp?: string) => {
    try {
      const acc = await loginElyBy(String(login ?? ''), String(password ?? ''), totp ? String(totp) : undefined);
      broadcast('accounts:changed');
      return { ok: true, account: acc };
    } catch (e) {
      // Код ошибки нужен окну: на TOTP оно покажет поле для кода
      return { ok: false, code: (e as { code?: string }).code ?? 'AUTH', message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('auth:ms:poll', async (deviceCode: string, interval: number, tenant?: string) => {
    const acc = await microsoft.waitForLogin(deviceCode, Number(interval) || 5, tenant || 'common');
    broadcast('accounts:changed');
    return acc;
  });
  handle('auth:ms:refresh', (id: string) => microsoft.refreshAccount(id));

  /* ------------------------------ Новости ------------------------------ */

  handle('news:list', (force?: boolean) => getNews(!!force));
  handle('news:java', () => getJavaNews());
  handle('news:patchNotes', () => getPatchNotes());
  handle('news:patchNote', (id: string) => getPatchNote(id));

  /* ------------------------------ Версии и загрузчики ------------------------------ */

  handle('versions:list', (includeSnapshots?: boolean) => listVersions(!!includeSnapshots));
  handle('versions:installed', async (versionId: string) => isVersionInstalled(versionId));
  handle('versions:loaders', (gameVersion: string, kind: 'forge' | 'neoforge' | 'fabric' | 'quilt') =>
    listLoaderVersions(kind, gameVersion)
  );
  handle('versions:installLoader', (gameVersion: string, kind: string, loaderVersion: string) =>
    installLoader(gameVersion, kind as never, loaderVersion)
  );
  handle('versions:resolveId', (gameVersion: string, loader: { kind: string; version?: string }) =>
    versionIdFor(gameVersion, loader as never)
  );

  /* ------------------------------ Java ------------------------------ */

  handle('java:list', async () => (await detectJava(true)).map((j) => ({ ...j })));
  handle('java:ensure', async (versionId: string) => {
    const settings = readSettings();
    const { resolveVersion } = await import('./services/versions');
    const { json } = await resolveVersion(versionId);
    return ensureJava(json, { allowDownload: settings.java.autoDownloadJava });
  });
  handle('java:recommend', (versionId: string) => recommendJava(versionId));
  handle('java:download', async (component: string) => {
    const install = await downloadJava(component);
    return { path: install.path, major: install.major, label: install.label };
  });

  /* ------------------------------ Запуск игры ------------------------------ */

  handle('launch:start', (instanceId: string, opts?: { quickPlayServer?: string; quickPlayWorld?: string }) =>
    launchInstance(instanceId, opts ?? {})
  );
  handle('launch:stop', (instanceId: string) => stopInstance(instanceId));
  handle('launch:running', () => listRunning());

  /* ------------------------------ Логи ------------------------------ */

  handle('logs:get', (instanceId: string) => getLogs(instanceId));
  handle('logs:clear', (instanceId: string) => clearLogs(instanceId));
  handle('logs:export', (instanceId: string, target: string) => exportLog(instanceId, target));

  /* ------------------------------ Загрузки ------------------------------ */

  handle('downloads:list', () => getTasks());
  handle('downloads:stats', () => getDownloadStats());
  handle('downloads:pause', (taskId: string) => pauseTask(taskId));
  handle('downloads:resume', (taskId: string) => resumeTask(taskId));

  /* ------------------------------ Разбор падений ------------------------------ */

  handle('crash:analyze', (instanceId: string, exitCode?: number | null) =>
    analyzeCrash(instanceId, { exitCode })
  );
  handle('crash:apply', (instanceId: string, causes: CrashCause[]) => applyCrashFixes(instanceId, causes));
  handle('crash:rollback', (instanceId: string, backupDir: string) =>
    rollbackCrashBackup(instanceId, backupDir)
  );

  /* ------------------------------ Импорт из лаунчеров ------------------------------ */

  handle('import:detect', (extraPaths?: string[]) => detectLaunchers({ extraPaths }));
  handle('import:run', (info: unknown, options: unknown) => importDetected(info as never, options as never));
  handle('import:deleteSource', (sourcePath: string) => deleteImportedSource(sourcePath));
  handle('import:archive', async (file?: string, options?: unknown) => {
    let target = file;
    if (!target) {
      const res = await dialog.showOpenDialog({
        title: 'Импорт сборки из файла',
        filters: [{ name: 'Модпаки и архивы', extensions: ['mrpack', 'zip'] }],
        properties: ['openFile']
      });
      if (res.canceled || !res.filePaths[0]) return null;
      target = res.filePaths[0];
    }
    return importArchive(target, options as never);
  });
  handle('import:format', (file: string) => detectArchiveFormat(file));
  handle('import:matchMods', (instanceId: string) => matchMods(instanceId));

  /* ------------------------------ Зависимости ------------------------------ */

  handle('deps:plan', (instanceId: string, source: 'modrinth' | 'curseforge', projectId: string, versionId?: string) => {
    const inst = instances.readInstance(instanceId);
    if (!inst) throw new Error('Сборка не найдена');
    return buildPlan(inst, source, projectId, versionId);
  });
  handle('deps:install', (instanceId: string, plan: DependencyPlan, keys: string[]) => {
    const inst = instances.readInstance(instanceId);
    if (!inst) throw new Error('Сборка не найдена');
    return installPlan(inst, plan, keys);
  });
  handle('deps:check', (instanceId: string) => {
    const inst = instances.readInstance(instanceId);
    if (!inst) throw new Error('Сборка не найдена');
    return checkBuild(inst);
  });
  handle('deps:fix', async (instanceId: string, issueIds: string[]) => {
    const inst = instances.readInstance(instanceId);
    if (!inst) throw new Error('Сборка не найдена');
    const issues = await checkBuild(inst);
    const actions = planAutoFix(issues).filter((a) => issueIds.includes(a.issueId));
    const results: { issueId: string; action: string; status: string; detail?: string }[] = [];
    for (const action of actions) {
      try {
        if (action.action === 'install-dependency') {
          const source = action.payload.source as 'modrinth' | 'curseforge';
          const projectId = String(action.payload.projectId);
          const plan = await buildPlan(inst, source, projectId, action.payload.versionId as string | undefined);
          const keys = plan.items.filter((i) => i.selected).map((i) => i.key);
          const res = await installPlan(inst, plan, keys);
          results.push({ issueId: action.issueId, action: action.action, status: 'applied', detail: `файлов: ${res.installedKeys.length}` });
        } else if (action.action === 'update-mod') {
          await mods.updateMod(instanceId, String(action.payload.modId));
          results.push({ issueId: action.issueId, action: action.action, status: 'applied' });
        } else if (action.action === 'replace-version') {
          // Самая свежая версия мода для версии игры и загрузчика сборки
          const mod = mods.scanMods(instanceId).find((m) => m.id === String(action.payload.modId));
          const fresh =
            mod?.projectId && mod.source !== 'local'
              ? (await catalogVersions(mod.source, mod.projectId, inst.gameVersion, inst.loader.kind === 'vanilla' ? undefined : inst.loader.kind))[0]
              : undefined;
          if (!fresh) {
            results.push({ issueId: action.issueId, action: action.action, status: 'error', detail: `Для ${inst.gameVersion} нет подходящей версии «${mod?.name ?? String(action.payload.modId)}» — мод лучше выключить.` });
          } else if (fresh.id === mod?.versionId) {
            results.push({ issueId: action.issueId, action: action.action, status: 'applied', detail: 'уже подходящая версия' });
          } else {
            await mods.updateMod(instanceId, String(action.payload.modId), fresh);
            results.push({ issueId: action.issueId, action: action.action, status: 'applied' });
          }
        } else if (action.action === 'enable-mod') {
          await mods.setModEnabled(instanceId, String(action.payload.modId), true);
          results.push({ issueId: action.issueId, action: action.action, status: 'applied' });
        } else if (action.action === 'disable-mod') {
          await mods.setModEnabled(instanceId, String(action.payload.modId), false);
          results.push({ issueId: action.issueId, action: action.action, status: 'applied' });
        } else if (action.action === 'remove-duplicate') {
          const remove = Array.isArray(action.payload.remove) ? (action.payload.remove as string[]) : [];
          for (const id of remove) await mods.removeMod(instanceId, id);
          results.push({ issueId: action.issueId, action: action.action, status: 'applied', detail: `удалено: ${remove.length}` });
        } else {
          results.push({
            issueId: action.issueId,
            action: action.action,
            status: 'manual',
            detail: action.description
          });
        }
      } catch (e) {
        results.push({
          issueId: action.issueId,
          action: action.action,
          status: 'error',
          detail: e instanceof Error ? e.message : String(e)
        });
      }
    }
    return results;
  });
  handle('downloads:cancel', (taskId: string) => cancelDownloadTask(taskId));

  /* ------------------------------ Каталог ------------------------------ */

  handle('catalog:search', (query: CatalogSearchQuery) => searchCatalog(query));
  handle('catalog:versions', (source: 'modrinth' | 'curseforge', projectId: string, gameVersion?: string, loader?: string) =>
    catalogVersions(source, projectId, gameVersion, loader)
  );
  handle('catalog:project', (source: 'modrinth' | 'curseforge', id: string) => catalogProject(source, id));
  handle('catalog:curseforgeAvailable', () => isCurseForgeAvailable());
  handle('download:file', async (url: string, fileName: string, sha1?: string) => {
    const safe = fileName.replace(/[\\/:*?"<>|]/g, '_');
    const dir = path.join(app.getPath('downloads'), 'Ploxel');
    await fsp.mkdir(dir, { recursive: true });
    let dest = path.join(dir, safe);
    let counter = 2;
    const ext = path.extname(safe);
    const base = safe.slice(0, safe.length - ext.length);
    while (fsSync.existsSync(dest)) dest = path.join(dir, `${base} (${counter++})${ext}`);
    await downloadFile({ url, dest, sha1 });
    return dest;
  });
  handle('integrations:curseforgeStatus', () => isCurseForgeAvailable());
  handle('integrations:msStatus', () => hasSecret('ms-client-id') || !!getConfig().microsoftClientId);
  handle('integrations:setMsClientId', (clientId: string) => {
    const ok = setSecret('ms-client-id', clientId.trim());
    if (!ok) throw new Error('Системное хранилище недоступно');
    return true;
  });
  handle('integrations:clearMsClientId', () => {
    deleteSecret('ms-client-id');
    return false;
  });

  /* ------------------------------ Моды сборки ------------------------------ */

  handle('mods:list', (instanceId: string) => mods.scanMods(instanceId));
  handle('mods:setEnabled', (instanceId: string, modId: string, enabled: boolean) =>
    mods.setModEnabled(instanceId, modId, enabled)
  );
  handle('mods:remove', (instanceId: string, modId: string) => mods.removeMod(instanceId, modId));
  handle('mods:transfer', (fromId: string, modId: string, toId: string, opts: { keepCopy?: boolean }) =>
    mods.transferMod(fromId, modId, toId, opts)
  );
  handle('mods:install', async (instanceId: string, source: 'modrinth' | 'curseforge', projectId: string, kind: InstalledMod['kind'], opts: { versionId?: string; projectName?: string; projectIcon?: string }) => {
    const instance = instances.readInstance(instanceId);
    if (!instance) throw new Error('Сборка не найдена');
    const settings = readSettings();
    return mods.installProject(instance, source, projectId, kind, {
      ...opts,
      withDependencies: settings.general.dependencyHelper
    });
  });
  handle('mods:checkUpdates', (instanceId: string) => mods.checkUpdates(instanceId));
  handle('mods:update', (instanceId: string, modId: string) => mods.updateMod(instanceId, modId));
  handle('mods:rollback', (instanceId: string, modId: string) => mods.rollbackMod(instanceId, modId));
  handle('playtime:week', () => weekSummary());
  handle('mods:identify', (instanceId: string) => mods.identifyLocalMods(instanceId));
  handle('mods:addFiles', (instanceId: string, kind: InstalledMod['kind'], files: string[]) =>
    mods.addLocalFiles(instanceId, kind, files)
  );
  // Категории Modrinth установленных проектов — для фильтра на странице сборки
  handle('mods:categories', async (instanceId: string) => {
    const ids = mods.scanMods(instanceId).filter((m) => m.source === 'modrinth' && m.projectId).map((m) => m.projectId!);
    const briefs = ids.length ? await getModrinthProjectBriefs(ids).catch(() => ({})) : {};
    return Object.fromEntries(Object.entries(briefs).map(([id, b]) => [id, (b as { categories: string[] }).categories]));
  });
  handle('mods:duplicates', (instanceId: string) => mods.findDuplicates(mods.scanMods(instanceId)));

  /* ------------------------------ Модпаки ------------------------------ */

  handle('modpack:installFromProject', (source: 'modrinth' | 'curseforge', projectId: string, versionId?: string) =>
    installModpackFromProject(source, projectId, versionId)
  );
  handle('modpack:import', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Импорт модпака',
      filters: [{ name: 'Модпаки', extensions: ['mrpack', 'zip'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return installModpackFileWithTask(res.filePaths[0]);
  });
  handle('modpack:manualMods', (instanceId: string) => manualModsCount(instanceId));
  handle('modpack:importFile', (file: string) => installModpackFileWithTask(file));
  handle('modpack:export', async (instanceId: string, target?: string) => {
    const dest =
      target ??
      (
        await dialog.showSaveDialog({
          title: 'Экспорт сборки',
          defaultPath: `${instanceId}.mrpack`,
          filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }]
        })
      ).filePath;
    if (!dest) return null;
    return exportMrpack(instanceId, dest);
  });
  handle('modpack:exportCurseForge', async (instanceId: string, target?: string) => {
    const dest =
      target ??
      (
        await dialog.showSaveDialog({
          title: 'Экспорт сборки для CurseForge',
          defaultPath: `${instanceId}.zip`,
          filters: [{ name: 'CurseForge modpack', extensions: ['zip'] }]
        })
      ).filePath;
    if (!dest) return null;
    return exportCurseForgeZip(instanceId, dest);
  });

  /* ------------------------------ Импорт .minecraft ------------------------------ */

  handle('minecraft:scan', (folder: string) => {
    const versionsDir = path.join(folder, 'versions');
    const versions: string[] = [];
    if (fsSync.existsSync(versionsDir)) {
      for (const entry of fsSync.readdirSync(versionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (fsSync.existsSync(path.join(versionsDir, entry.name, `${entry.name}.json`))) versions.push(entry.name);
      }
    }
    const modsDir = path.join(folder, 'mods');
    const mods = fsSync.existsSync(modsDir)
      ? fsSync.readdirSync(modsDir).filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled')).length
      : 0;
    const savesDir = path.join(folder, 'saves');
    const worlds = fsSync.existsSync(savesDir)
      ? fsSync.readdirSync(savesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
      : 0;
    return { versions, mods, worlds };
  });
  handle('minecraft:import', (input: { folder: string; name: string; gameVersion: string; loader: { kind: string; version?: string } }) =>
    importMinecraftFolder({
      folder: input.folder,
      name: input.name,
      gameVersion: input.gameVersion,
      loader: input.loader as never
    })
  );

  /* ------------------------------ ИИ-помощник ------------------------------ */

  handle('ai:available', () => aiAvailable());
  handle('ai:preview', (log: string, nick?: string) => sanitizeLog(log, nick).slice(-12000));
  handle('ai:explain', (log: string, nick?: string) => analyzeLog(log, nick));
  handle('ai:pickBuild', (input: AiPickInput) => pickBuild(input));
  handle('ai:assemble', (spec: AssembleSpec) => startAssemble(spec));
  handle('ai:improvePick', (instanceId: string, text: string) => pickImprove(instanceId, text));
  handle('ai:improve', (instanceId: string, items: AssembleItem[]) => startImprove(instanceId, items));
  handle('ai:chat', (messages: { role: 'user' | 'assistant'; content: string }[]) => chat(messages));
  handle('translate:text', (text: string, target: string) => translateText(text, target));
  handle('translate:page', (summary: string, body: string, target: string) => translatePage(summary, body, target));
  handle('ai:test', () => testAi());
  handle('ai:hasKey', () => hasSecret('ai-key'));
  handle('ai:setKey', (key: string) => setSecret('ai-key', key));
  handle('ai:clearKey', () => {
    deleteSecret('ai-key');
    return true;
  });

  /* ------------------------------ Внешний вид: экспорт/импорт ------------------------------ */

  handle('appearance:export', async () => {
    const res = await dialog.showSaveDialog({
      title: 'Экспорт внешнего вида',
      defaultPath: 'ploxel-appearance.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return null;
    const json = exportAppearance(loadSettings().appearance);
    await fsp.writeFile(res.filePath, json, 'utf8');
    return res.filePath;
  });
  handle('appearance:import', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Импорт внешнего вида',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = await fsp.readFile(res.filePaths[0], 'utf8');
    const parsed = importAppearance(text);
    if (!parsed.ok || !parsed.appearance) throw new Error(parsed.error ?? 'Не удалось прочитать файл');
    const next = saveSettings({ appearance: parsed.appearance });
    broadcast('settings:changed', next);
    return { settings: next, warning: parsed.error ?? null };
  });

  /* ------------------------------ Обновления ------------------------------ */

  handle('update:check', () => checkForUpdates());
  // Ссылку на установщик берём заново с GitHub, а не из окна: подменить её нельзя
  handle('update:install', async () => downloadAndRunUpdate(await checkForUpdates()));

  /* ------------------------------ Миры ------------------------------ */

  handle('worlds:list', (instanceId?: string) => listWorlds(instanceId));
  handle('worlds:import', async (instanceId: string) => {
    const res = await dialog.showOpenDialog({
      title: 'Импорт мира',
      filters: [{ name: 'Архив мира', extensions: ['zip'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return importWorld(instanceId, res.filePaths[0]);
  });
  handle('worlds:importFile', (instanceId: string, file: string) => importWorld(instanceId, file));
  handle('worlds:export', async (instanceId: string, folder: string, target?: string) => {
    const dest =
      target ??
      (
        await dialog.showSaveDialog({
          title: 'Экспорт мира',
          defaultPath: `${folder}.zip`,
          filters: [{ name: 'Архив мира', extensions: ['zip'] }]
        })
      ).filePath;
    if (!dest) return null;
    return exportWorld(instanceId, folder, dest);
  });
  handle('worlds:open', (instanceId: string, folder: string) => shell.openPath(worldFolder(instanceId, folder)));

  /* ------------------------------ Скины ------------------------------ */

  handle('skins:state', () => skins.getSkinState());
  handle('skins:import', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Выберите скин',
      filters: [{ name: 'PNG', extensions: ['png'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return skins.getSkinState();
    const state = await skins.importSkin(res.filePaths[0]);
    broadcast('skins:changed');
    return state;
  });
  handle('skins:importFile', async (file: string) => {
    const state = await skins.importSkin(file);
    broadcast('skins:changed');
    return state;
  });
  handle('skins:savePng', async (dataUrl: string, name?: string) => {
    const state = await skins.saveSkinFromDataUrl(dataUrl, name);
    broadcast('skins:changed');
    return state;
  });
  handle('skins:select', (file: string) => {
    const state = skins.selectSkin(file);
    broadcast('skins:changed');
    return state;
  });
  handle('skins:variant', (variant: 'classic' | 'slim') => {
    const state = skins.setVariant(variant);
    broadcast('skins:changed');
    return state;
  });
  handle('skins:layers', (layers: Partial<SkinLayers>) => {
    const state = skins.setLayers(layers);
    broadcast('skins:changed');
    return state;
  });
  handle('skins:clear', () => {
    const state = skins.clearLocalSkin();
    broadcast('skins:changed');
    return state;
  });
  handle('skins:upload', (accountId: string, pngDataUrl?: string) => skins.uploadCurrentSkin(accountId, pngDataUrl));
  handle('skins:openFolder', () => shell.openPath(skins.skinsFolder()));
  handle('skins:export', (pngDataUrl: string, target: string) => skins.exportSkin(pngDataUrl, target));
  handle('skins:reset', (accountId: string) => skins.resetAccountSkin(accountId));
  handle('skins:capes', (accountId: string) => skins.getCapes(accountId));
  handle('skins:setCape', (accountId: string, capeId: string | null) => skins.setCape(accountId, capeId));
}