import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './paths';
import { launchOutsideApp } from './detached';
import { buildCleanupScript, findUninstaller, installedAppDir, ownInstancesDir, ownMovedDataRoot, ownUserDataDir, type FullCleanup } from '../core/uninstall';

export interface UninstallResult {
  scheduled: boolean;
  /** Сборки пользователя удалены (только если он поставил галочку) */
  removedInstances: boolean;
  warning?: string;
}

/**
 * Удаление лаунчера: сейчас — только свои сборки (если отмечено), затем
 * отдельный сценарий PowerShell ждёт выхода приложения и запускает штатный
 * деинсталлятор. Другие версии Ploxel и чужие файлы не затрагиваются.
 */
export function uninstallLauncher(options: { deleteInstances?: boolean; deleteAllData?: boolean }): UninstallResult {
  const appDir = installedAppDir(app.getPath('exe'), app.isPackaged);
  let removedInstances = false;
  let warning: string | undefined;

  // Полное удаление: всё стирается сценарием после выхода лаунчера
  // (пока он работает, файлы данных заняты)
  let full: FullCleanup | null = null;
  if (options.deleteAllData) {
    const userData = ownUserDataDir(app.getPath('userData'), process.env.APPDATA ?? '');
    const movedRoot = ownMovedDataRoot(getRoot(), app.getPath('userData'));
    full = { userData, movedRoot, desktop: app.getPath('desktop') };
    removedInstances = true;
    if (!userData) warning = 'Папка настроек лежит не на стандартном месте — она оставлена, удалите её вручную.';
  }

  if (options.deleteInstances && !options.deleteAllData) {
    const dir = ownInstancesDir(getRoot(), path.join(getRoot(), 'instances'));
    if (!dir) {
      warning = 'Папка сборок не принадлежит лаунчеру — она оставлена на месте.';
    } else {
      try {
        if (fs.existsSync(dir)) {
          const stat = fs.lstatSync(dir);
          if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('папка сборок — ссылка');
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
        }
        removedInstances = true;
      } catch (e) {
        warning = `Не удалось удалить сборки: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(appDir);
  } catch {
    files = [];
  }
  const uninstaller = findUninstaller(files, appDir);
  const scriptPath = path.join(os.tmpdir(), `ploxel-uninstall-${Date.now()}.ps1`);
  // BOM — чтобы PowerShell 5.1 прочитал кириллицу в путях
  fs.writeFileSync(scriptPath, '﻿' + buildCleanupScript(appDir, uninstaller, full), 'utf8');
  // Сценарий должен пережить закрытие лаунчера — обычный spawn его убивал
  launchOutsideApp('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath]);
  return { scheduled: true, removedInstances, warning };
}