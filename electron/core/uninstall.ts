/**
 * Проверки перед удалением приложения.
 *
 * Удалять можно только установленный Ploxel (Ploxel.exe в своей папке) и,
 * если пользователь отметил галочку, свою папку сборок внутри корня данных.
 * Всё остальное — другие версии лаунчера, общие файлы, диск, профиль
 * пользователя — трогать нельзя. Эти функции чистые и покрыты тестами.
 */

import os from 'node:os';
import path from 'node:path';

const FORBIDDEN_DIRS = (): string[] =>
  [
    path.parse(process.cwd()).root,
    os.homedir(),
    os.tmpdir(),
    process.env.WINDIR ?? 'C:\\Windows',
    process.env.ProgramFiles ?? 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    process.env.ProgramData ?? 'C:\\ProgramData',
    process.env.APPDATA ?? '',
    process.env.LOCALAPPDATA ?? ''
  ]
    .filter(Boolean)
    .map((d) => path.resolve(d).toLowerCase());

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Папка установки из пути к exe — или понятная ошибка, почему удалять нельзя. */
export function installedAppDir(exePath: string, packaged: boolean): string {
  if (!packaged) {
    throw new Error('Удаление доступно только для установленной версии Ploxel.');
  }
  if (path.basename(exePath).toLowerCase() !== 'ploxel.exe') {
    throw new Error('Это не установленный Ploxel — удаление отменено.');
  }
  const dir = path.resolve(path.dirname(exePath));
  if (dir.toLowerCase().split(path.sep).filter(Boolean).length < 2) {
    throw new Error('Папка установки слишком высоко в файловой системе — удаление отменено.');
  }
  if (FORBIDDEN_DIRS().some((bad) => samePath(dir, bad))) {
    throw new Error('Папка установки совпадает с системной — удаление отменено.');
  }
  if (/[\\/]node_modules([\\/]|$)/i.test(dir)) {
    throw new Error('Похоже на папку разработки, а не на установленный Ploxel.');
  }
  return dir;
}

/** Только папка instances внутри корня данных — не сам корень и не соседние файлы. */
export function ownInstancesDir(root: string, candidate: string): string | null {
  const expected = path.resolve(path.join(root, 'instances'));
  const target = path.resolve(candidate);
  if (!samePath(expected, target)) return null;
  if (!inside(root, target)) return null;
  return target;
}

/** Имя установщика удаления, который создаёт electron-builder (NSIS). */
export function findUninstaller(files: string[], appDir: string): string | null {
  const match = files.find((name) => /^Uninstall .*\.exe$/i.test(name));
  return match ? path.join(appDir, match) : null;
}

/** Экранирование для PowerShell в одинарных кавычках. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Сценарий очистки: ждёт выхода лаунчера, запускает штатный деинсталлятор
 * (он удаляет ярлыки и запись в «Установленных программах») либо, если его
 * нет, удаляет только папку этой версии.
 */
export function buildCleanupScript(appDir: string, uninstaller: string | null): string {
  const lines = [
    '$ErrorActionPreference = "SilentlyContinue"',
    'Start-Sleep -Seconds 3',
    `$app = ${psQuote(appDir)}`,
    `$un = ${uninstaller ? psQuote(uninstaller) : '$null'}`,
    'if ($un -and (Test-Path -LiteralPath $un)) {',
    '  Start-Process -FilePath $un -ArgumentList "/S" -WorkingDirectory $app -Wait',
    '}',
    'for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $app); $i++) {',
    '  Remove-Item -LiteralPath $app -Recurse -Force',
    '  if (Test-Path -LiteralPath $app) { Start-Sleep -Seconds 1 }',
    '}',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force'
  ];
  return lines.join('\r\n') + '\r\n';
}