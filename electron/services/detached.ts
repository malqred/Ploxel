import { execFileSync, spawn } from 'node:child_process';

/**
 * Запуск процесса, который должен пережить закрытие лаунчера (сценарий
 * удаления, установщик обновления).
 *
 * Обычный spawn({ detached: true }) здесь не годится: Electron держит свои
 * дочерние процессы в задании Windows (job) и при выходе убивает их — сценарий
 * удаления не доживал до начала работы. Поэтому процесс создаёт служба WMI
 * (он не входит в задание лаунчера), а если WMI недоступна — `cmd /c start`.
 */

function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

export function commandLine(file: string, args: string[]): string {
  return [file, ...args].map(quoteArg).join(' ');
}

/** Команда PowerShell, которая просит WMI создать процесс; код выхода — ReturnValue (0 — успех). */
export function wmiCreateScript(cmd: string): string {
  return `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmd.replace(/'/g, "''")}' }; exit [int]$r.ReturnValue`;
}

export function launchOutsideApp(file: string, args: string[]): 'wmi' | 'cmd' {
  const cmd = commandLine(file, args);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wmiCreateScript(cmd)], {
      windowsHide: true,
      timeout: 20000,
      stdio: 'ignore'
    });
    return 'wmi';
  } catch {
    // WMI выключена или вернула ошибку — запасной путь
    spawn('cmd.exe', ['/d', '/c', `start "" /b ${cmd}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    }).unref();
    return 'cmd';
  }
}
