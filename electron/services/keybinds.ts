import fs from 'node:fs';
import path from 'node:path';
import { instanceDir } from './paths';
import { loadSettings } from './settings';
import { buildKeybindLines, changedKeybinds } from '../../shared/keybinds';

/**
 * Общее управление из «Настройки управления» применяется к сборке один раз —
 * в момент создания. Дальше options.txt принадлежит пользователю: игра пишет
 * туда свои значения, и лаунчер его больше не трогает.
 */
export function applyKeybindsOnCreate(instanceId: string, gameVersion: string): { count: number; skipped: number } {
  const settings = loadSettings();
  if (!settings.controls?.applyToNewInstances) return { count: 0, skipped: 0 };

  const overrides = settings.controls?.keybinds ?? {};
  const applicable = changedKeybinds(overrides, gameVersion);
  const skipped = Object.keys(overrides).filter((id) => !applicable.some((k) => k.id === id)).length;
  if (!applicable.length) return { count: 0, skipped };

  const lines = buildKeybindLines(overrides, gameVersion);
  if (!lines.length) return { count: 0, skipped };

  const file = path.join(instanceDir(instanceId), 'options.txt');
  const ids = new Set(applicable.map((k) => `key_key.${k.id}:`));
  const kept: string[] = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      if ([...ids].some((prefix) => line.startsWith(prefix))) continue;
      kept.push(line);
    }
  } catch {
    /* файла ещё нет — создаём */
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, [...kept, ...lines].join('\n') + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return { count: lines.length, skipped };
}

/** Проверка перед созданием сборки: сколько клавиш достанется этой версии. */
export function keybindsFor(gameVersion: string): { count: number; skipped: number } {
  const overrides = loadSettings().controls?.keybinds ?? {};
  const applicable = changedKeybinds(overrides, gameVersion);
  return {
    count: buildKeybindLines(overrides, gameVersion).length,
    skipped: Object.keys(overrides).length - applicable.length
  };
}