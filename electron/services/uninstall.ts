import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './paths';
import { buildCleanupScript, findUninstaller, installedAppDir, ownInstancesDir } from '../core/uninstall';

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
export function uninstallLauncher(options: { deleteInstances?: boolean }): UninstallResult {
  const appDir = installedAppDir(app.getPath('exe'), app.isPackaged);
  let removedInstances = false;
  let warning: string | undefined;

  if (options.deleteInstances) {
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
  fs.writeFileSync(scriptPath, '﻿' + buildCleanupScript(appDir, uninstaller), 'utf8');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  return { scheduled: true, removedInstances, warning };
}