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

/** Что лаунчер сам создаёт в корне данных — при полном удалении стирается только это. */
export const ROOT_ENTRIES = [
  'data',
  'instances',
  'logs',
  'cache',
  'downloads',
  'backups',
  'secrets',
  'skins',
  'accounts.json',
  'settings.json',
  'playtime.json'
] as const;

/**
 * Папка приложения в %APPDATA% (кэш Chromium, переписка с помощником,
 * указатель root.json, корень данных по умолчанию). Удалять можно только
 * папку с именем Ploxel прямо внутри %APPDATA%.
 */
export function ownUserDataDir(userData: string, appData: string): string | null {
  if (!userData || !appData) return null;
  const dir = path.resolve(userData);
  if (path.basename(dir).toLowerCase() !== 'ploxel') return null;
  if (!samePath(path.dirname(dir), appData)) return null;
  if (FORBIDDEN_DIRS().some((bad) => samePath(dir, bad))) return null;
  return dir;
}

/**
 * Корень данных, перенесённый за пределы %APPDATA%\Ploxel: удаляются только
 * записи лаунчера (ROOT_ENTRIES), сама папка — лишь если после этого пуста.
 * null — корень лежит внутри userData (удалится вместе с ней) или опасен.
 */
export function ownMovedDataRoot(root: string, userData: string): { root: string; entries: string[] } | null {
  if (!root) return null;
  const dir = path.resolve(root);
  if (samePath(dir, userData) || inside(userData, dir)) return null;
  if (dir.toLowerCase().split(path.sep).filter(Boolean).length < 2) return null;
  if (FORBIDDEN_DIRS().some((bad) => samePath(dir, bad))) return null;
  if (/[\\/]node_modules([\\/]|$)/i.test(dir)) return null;
  return { root: dir, entries: ROOT_ENTRIES.map((e) => path.join(dir, e)) };
}

/** Что ещё стереть при полном удалении (всё проверено функциями выше). */
export interface FullCleanup {
  userData: string | null;
  movedRoot: { root: string; entries: string[] } | null;
  /** рабочий стол — ярлыки сборок, ведущие на этот Ploxel.exe */
  desktop: string | null;
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
export function buildCleanupScript(appDir: string, uninstaller: string | null, full?: FullCleanup | null): string {
  const lines = [
    '$ErrorActionPreference = "SilentlyContinue"',
    'Start-Sleep -Seconds 3',
    `$app = ${psQuote(appDir)}`,
    `$un = ${uninstaller ? psQuote(uninstaller) : '$null'}`
  ];
  // Ярлыки сборок на рабочем столе читаем до удаления программы
  if (full?.desktop) {
    lines.push(
      `$desk = ${psQuote(full.desktop)}`,
      '$exe = Join-Path $app "Ploxel.exe"',
      '$sh = New-Object -ComObject WScript.Shell',
      'Get-ChildItem -LiteralPath $desk -Filter *.lnk | ForEach-Object {',
      '  if ($sh.CreateShortcut($_.FullName).TargetPath -ieq $exe) { Remove-Item -LiteralPath $_.FullName -Force }',
      '}'
    );
  }
  lines.push(
    'if ($un -and (Test-Path -LiteralPath $un)) {',
    '  Start-Process -FilePath $un -ArgumentList "/S" -WorkingDirectory $app -Wait',
    '}',
    'for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $app); $i++) {',
    '  Remove-Item -LiteralPath $app -Recurse -Force',
    '  if (Test-Path -LiteralPath $app) { Start-Sleep -Seconds 1 }',
    '}'
  );
  if (full?.movedRoot) {
    lines.push(`$root = ${psQuote(full.movedRoot.root)}`);
    for (const entry of full.movedRoot.entries) {
      lines.push(`Remove-Item -LiteralPath ${psQuote(entry)} -Recurse -Force`);
    }
    // Папку корня — только если в ней не осталось чужих файлов
    lines.push('if ((Get-ChildItem -LiteralPath $root -Force | Measure-Object).Count -eq 0) { Remove-Item -LiteralPath $root -Force }');
  }
  if (full?.userData) {
    lines.push(
      `$ud = ${psQuote(full.userData)}`,
      'for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $ud); $i++) {',
      '  Remove-Item -LiteralPath $ud -Recurse -Force',
      '  if (Test-Path -LiteralPath $ud) { Start-Sleep -Seconds 1 }',
      '}'
    );
  }
  lines.push('Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force');
  return lines.join('\r\n') + '\r\n';
}