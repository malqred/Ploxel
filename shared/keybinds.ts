/**
 * Клавиши Minecraft: полный набор из 26.4 и совместимость по версиям.
 *
 * id привязки — то, что идёт после `key_key.` в options.txt:
 * привязка `key.forward` записывается как `key_key.forward`.
 * У каждой клавиши указано, с какой версии игры она существует: в более
 * старую сборку такая строка не попадёт, поэтому управление, настроенное
 * под 26.4, не ломает запуск 1.20.1.
 */

import { compareGameVersions } from './game-versions';

export type KeybindCategory = 'movement' | 'gameplay' | 'inventory' | 'multiplayer' | 'misc' | 'spectator' | 'debug';

export interface KeybindCategoryDef {
  id: KeybindCategory;
  label: string;
}

export interface KeybindDef {
  /** суффикс в options.txt: key_key.<id> */
  id: string;
  label: string;
  category: KeybindCategory;
  /** значение по умолчанию в новом формате (key.keyboard.w) */
  default?: string;
  /** минимальная версия игры, где привязка существует */
  since?: string;
  /** подпись по умолчанию для клавиш, которые задаются сочетанием */
  defaultHint?: string;
}

export const KEYBIND_CATEGORIES: KeybindCategoryDef[] = [
  { id: 'movement', label: 'Движение' },
  { id: 'gameplay', label: 'Игровой процесс' },
  { id: 'inventory', label: 'Инвентарь' },
  { id: 'multiplayer', label: 'Сетевая игра' },
  { id: 'misc', label: 'Разное' },
  { id: 'spectator', label: 'Режим наблюдателя' },
  { id: 'debug', label: 'Отладка' }
];

/** Версия с новым форматом клавиш (`key.keyboard.w`); раньше писались коды. */
export const NAMED_KEYS_SINCE = '1.13';

const hotbar = (n: number): KeybindDef => ({
  id: `hotbar.${n}`,
  label: `Слот ${n}`,
  category: 'inventory',
  default: `key.keyboard.${n}`
});

export const KEYBINDS: KeybindDef[] = [
  { id: 'forward', label: 'Вперёд', category: 'movement', default: 'key.keyboard.w' },
  { id: 'left', label: 'Влево', category: 'movement', default: 'key.keyboard.a' },
  { id: 'back', label: 'Назад', category: 'movement', default: 'key.keyboard.s' },
  { id: 'right', label: 'Вправо', category: 'movement', default: 'key.keyboard.d' },
  { id: 'jump', label: 'Прыжок', category: 'movement', default: 'key.keyboard.space' },
  { id: 'sneak', label: 'Красться', category: 'movement', default: 'key.keyboard.left.shift' },
  { id: 'sprint', label: 'Бег', category: 'movement', default: 'key.keyboard.left.control' },

  { id: 'attack', label: 'Атаковать/Разрушить', category: 'gameplay', default: 'key.mouse.left' },
  { id: 'use', label: 'Использовать/Установить', category: 'gameplay', default: 'key.mouse.right' },
  { id: 'pickItem', label: 'Выбор блока', category: 'gameplay', default: 'key.mouse.middle' },
  { id: 'drop', label: 'Выбросить предмет', category: 'gameplay', default: 'key.keyboard.q' },

  { id: 'inventory', label: 'Открыть/закрыть инвентарь', category: 'inventory', default: 'key.keyboard.e' },
  { id: 'swapOffhand', label: 'Заменить предмет во второй руке', category: 'inventory', default: 'key.keyboard.f', since: '1.16.5' },
  hotbar(1),
  hotbar(2),
  hotbar(3),
  hotbar(4),
  hotbar(5),
  hotbar(6),
  hotbar(7),
  hotbar(8),
  hotbar(9),
  { id: 'saveToolbarActivator', label: 'Сохранить инструменты', category: 'inventory', default: 'key.keyboard.c', since: '1.13.2' },
  { id: 'loadToolbarActivator', label: 'Загрузить инструменты', category: 'inventory', default: 'key.keyboard.x', since: '1.13.2' },

  { id: 'playerlist', label: 'Список игроков', category: 'multiplayer', default: 'key.keyboard.tab' },
  { id: 'chat', label: 'Открыть чат', category: 'multiplayer', default: 'key.keyboard.t' },
  { id: 'command', label: 'Ввод команды', category: 'multiplayer', default: 'key.keyboard.slash' },
  { id: 'socialInteractions', label: 'Экран социальных взаимодействий', category: 'multiplayer', since: '1.16.5' },
  { id: 'friends', label: 'Друзья', category: 'multiplayer', since: '26.2' },

  { id: 'advancements', label: 'Достижения', category: 'misc', default: 'key.keyboard.l', since: '1.13.2' },
  { id: 'screenshot', label: 'Сделать снимок экрана', category: 'misc', default: 'key.keyboard.f2' },
  { id: 'fullscreen', label: 'Полноэкранный режим', category: 'misc', default: 'key.keyboard.f11' },
  { id: 'togglePerspective', label: 'Переключить перспективу', category: 'misc', default: 'key.keyboard.f5' },
  { id: 'smoothCamera', label: 'Кинематографическая камера', category: 'misc' },
  { id: 'toggleGui', label: 'Переключение интерфейса', category: 'misc', default: 'key.keyboard.f1', since: '26.1' },
  { id: 'quickActions', label: 'Быстрые действия', category: 'misc', since: '1.21.6' },

  { id: 'spectatorOutlines', label: 'Подсветка игроков', category: 'spectator' },
  { id: 'spectatorHotbar', label: 'Выбрать на панели быстрого доступа', category: 'spectator', since: '1.21.9' },
  { id: 'toggleSpectatorShaderEffects', label: 'Переключение шейдеров наблюдения', category: 'spectator', since: '26.1' },
  { id: 'otherPlayers', label: 'Другие игроки', category: 'spectator', since: '26.4' }
];

const DEBUG: { id: string; label: string; key?: string; hint?: string; since?: string }[] = [
  { id: 'debug.modifier', label: 'Клавиша-модификатор отладки', key: 'f3' },
  { id: 'debug.overlay', label: 'Переключить экран отладки', hint: 'F3' },
  { id: 'debug.showHitboxes', label: 'Отображать хитбоксы', key: 'b' },
  { id: 'debug.showChunkBorders', label: 'Отображать границы чанков', key: 'g' },
  { id: 'debug.showAdvancedTooltips', label: 'Показывать расширенные подсказки', key: 'h' },
  { id: 'debug.reloadChunk', label: 'Перезагрузить чанки', key: 'a' },
  { id: 'debug.reloadResourcePacks', label: 'Перезагрузить наборы ресурсов', key: 't' },
  { id: 'debug.copyLocation', label: 'Копировать координаты', key: 'c' },
  { id: 'debug.copyRecreateCommand', label: 'Копировать данные', key: 'i' },
  { id: 'debug.clearChat', label: 'Очистить чат', key: 'd' },
  { id: 'debug.switchGameMode', label: 'Переключатель режима игры', key: 'n' },
  { id: 'debug.focusPause', label: 'Переключить паузу при сворачивании', key: 'p' },
  { id: 'debug.profiling', label: 'Начать/остановить профилирование', key: 'l' },
  { id: 'debug.fpsCharts', label: 'Графики FPS', key: '2' },
  { id: 'debug.networkCharts', label: 'Сетевые графики', key: '3' },
  { id: 'debug.profilingChart', label: 'Диаграмма профилирования' },
  { id: 'debug.lightmapTexture', label: 'Карта освещения' },
  { id: 'debug.spectate', label: 'Переключить режим наблюдателя' },
  { id: 'debug.crash', label: 'Отладочный сбой' },
  { id: 'debug.debugOptions', label: 'Параметры отладки' },
  { id: 'debug.dumpDynamicTextures', label: 'Сохранить динамические текстуры' },
  { id: 'debug.dumpVersion', label: 'Вывести информацию о версии' },
  { id: 'debug.improvedTransparency', label: 'Улучшенная прозрачность', since: '26.3' }
];

for (const item of DEBUG) {
  KEYBINDS.push({
    id: item.id,
    label: item.label,
    category: 'debug',
    default: item.key ? `key.keyboard.${item.key}` : undefined,
    since: item.since ?? '26.1',
    defaultHint: item.hint ?? (item.key ? `F3 + ${item.key.toUpperCase()}` : undefined)
  });
}

export function keybindById(id: string): KeybindDef | undefined {
  return KEYBINDS.find((k) => k.id === id);
}

/** Существует ли привязка в этой версии игры. */
export function keybindAvailable(def: KeybindDef, gameVersion: string): boolean {
  if (!gameVersion) return true;
  return !def.since || compareGameVersions(gameVersion, def.since) >= 0;
}

/** Привязки, которые понимает версия игры. */
export function keybindsForVersion(gameVersion: string): KeybindDef[] {
  return KEYBINDS.filter((k) => keybindAvailable(k, gameVersion));
}

/** С 1.13 клавиши в options.txt записываются как key.keyboard.w, раньше — числом. */
export function usesNamedKeys(gameVersion: string): boolean {
  if (!gameVersion) return true;
  return compareGameVersions(gameVersion, NAMED_KEYS_SINCE) >= 0;
}

/** Все привязки, изменённые пользователем и пригодные для этой версии. */
export function changedKeybinds(overrides: Record<string, string>, gameVersion: string): { id: string; value: string }[] {
  const out: { id: string; value: string }[] = [];
  for (const def of KEYBINDS) {
    const value = overrides[def.id];
    if (!value) continue;
    if (!keybindAvailable(def, gameVersion)) continue;
    if (!isValidKeySpec(value)) continue;
    out.push({ id: def.id, value });
  }
  return out;
}

/** Строки для options.txt — только изменённые клавиши, с учётом формата версии. */
export function buildKeybindLines(overrides: Record<string, string>, gameVersion: string): string[] {
  const named = usesNamedKeys(gameVersion);
  const lines: string[] = [];
  for (const { id, value } of changedKeybinds(overrides, gameVersion)) {
    const encoded = named ? value : legacyCode(value);
    if (encoded === null) continue;
    lines.push(`key_key.${id}:${encoded}`);
  }
  return lines;
}

export function isValidKeySpec(spec: string): boolean {
  return /^key\.(keyboard|mouse)\.[a-z0-9._]+$/.test(spec);
}

// До 1.13 игра работала на LWJGL2 — там другие числовые коды клавиш
// (W = 17, пробел = 57), поэтому для старых сборок нужна эта таблица, а не GLFW.
const LEGACY_KEYBOARD: Record<string, number> = {
  escape: 1,
  '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
  minus: 12,
  equal: 13,
  backspace: 14,
  tab: 15,
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  'left.bracket': 26,
  'right.bracket': 27,
  enter: 28,
  'left.control': 29,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  semicolon: 39,
  apostrophe: 40,
  'grave.accent': 41,
  'left.shift': 42,
  backslash: 43,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
  comma: 51,
  period: 52,
  slash: 53,
  'right.shift': 54,
  'keypad.multiply': 55,
  'left.alt': 56,
  space: 57,
  'caps.lock': 58,
  'scroll.lock': 70,
  'num.lock': 69,
  'keypad.0': 82, 'keypad.1': 79, 'keypad.2': 80, 'keypad.3': 81, 'keypad.4': 75,
  'keypad.5': 76, 'keypad.6': 77, 'keypad.7': 71, 'keypad.8': 72, 'keypad.9': 73,
  'keypad.decimal': 83,
  'keypad.divide': 181,
  'keypad.subtract': 74,
  'keypad.add': 78,
  'keypad.enter': 156,
  'keypad.equal': 146,
  'right.control': 157,
  'print.screen': 183,
  'right.alt': 184,
  pause: 197,
  home: 199,
  up: 200,
  'page.up': 201,
  left: 203,
  right: 205,
  end: 207,
  down: 208,
  'page.down': 209,
  insert: 210,
  delete: 211,
  'left.win': 219,
  'right.win': 220,
  menu: 221
};

const F_KEYS = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 100, 101, 102, 103, 104, 105, 113, 114, 115, 116, 117, 118, 119];
F_KEYS.forEach((code, i) => {
  LEGACY_KEYBOARD[`f${i + 1}`] = code;
});

const LEGACY_MOUSE: Record<string, number> = { left: 0, right: 1, middle: 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8 };

/** Числовой код клавиши для версий до 1.13; null — такой клавиши там нет. */
export function legacyCode(spec: string): number | null {
  const mouse = spec.match(/^key\.mouse\.(.+)$/);
  if (mouse) return LEGACY_MOUSE[mouse[1]] ?? null;
  const keyboard = spec.match(/^key\.keyboard\.(.+)$/);
  if (!keyboard) return null;
  return LEGACY_KEYBOARD[keyboard[1]] ?? null;
}

export const KEY_LABELS: Record<string, string> = {
  space: 'Пробел',
  apostrophe: "'",
  comma: ',',
  minus: '-',
  period: '.',
  slash: '/',
  semicolon: ';',
  equal: '=',
  'left.bracket': '[',
  backslash: '\\',
  'right.bracket': ']',
  'grave.accent': '`',
  escape: 'Escape',
  enter: 'Ввод',
  tab: 'Tab',
  backspace: 'Backspace',
  insert: 'Insert',
  delete: 'Delete',
  right: '→',
  left: '←',
  down: '↓',
  up: '↑',
  'page.up': 'Page Up',
  'page.down': 'Page Down',
  home: 'Home',
  end: 'End',
  'caps.lock': 'Caps Lock',
  'scroll.lock': 'Scroll Lock',
  'num.lock': 'Num Lock',
  'print.screen': 'Print Screen',
  pause: 'Pause',
  'left.shift': 'Shift слева',
  'left.control': 'Ctrl слева',
  'left.alt': 'Alt слева',
  'left.win': 'Win слева',
  'right.shift': 'Shift справа',
  'right.control': 'Ctrl справа',
  'right.alt': 'Alt справа',
  'right.win': 'Win справа',
  menu: 'Menu',
  'keypad.decimal': '. (цифр. кл.)',
  'keypad.divide': '/ (цифр. кл.)',
  'keypad.multiply': '* (цифр. кл.)',
  'keypad.subtract': '- (цифр. кл.)',
  'keypad.add': '+ (цифр. кл.)',
  'keypad.enter': 'Ввод (ц. кл.)',
  'keypad.equal': '= (цифр. кл.)'
};

/** Человекочитаемая подпись клавиши: W, ЛКМ, Shift слева. */
export function describeKey(spec?: string): string {
  if (!spec || spec === 'key.keyboard.unknown') return 'Не назначена';
  const mouse = spec.match(/^key\.mouse\.(.+)$/);
  if (mouse) {
    const names: Record<string, string> = { left: 'ЛКМ', right: 'ПКМ', middle: 'СКМ' };
    return names[mouse[1]] ?? `Кнопка ${mouse[1]}`;
  }
  const keyboard = spec.match(/^key\.keyboard\.(.+)$/);
  if (!keyboard) return spec;
  const name = keyboard[1];
  if (KEY_LABELS[name]) return KEY_LABELS[name];
  if (/^f\d+$/.test(name)) return name.toUpperCase();
  if (/^keypad\.\d$/.test(name)) return `Num ${name.slice(-1)}`;
  if (name.length === 1) return name.toUpperCase();
  return name;
}

/** Клавиша из KeyboardEvent.code (физическая клавиша, не раскладка). */
export function keySpecFromCode(code: string): string | null {
  const simple: Record<string, string> = {
    Space: 'space',
    Enter: 'enter',
    NumpadEnter: 'keypad.enter',
    Escape: 'escape',
    Tab: 'tab',
    Backspace: 'backspace',
    Delete: 'delete',
    Insert: 'insert',
    Home: 'home',
    End: 'end',
    PageUp: 'page.up',
    PageDown: 'page.down',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    CapsLock: 'caps.lock',
    NumLock: 'num.lock',
    ScrollLock: 'scroll.lock',
    PrintScreen: 'print.screen',
    Pause: 'pause',
    ContextMenu: 'menu',
    Minus: 'minus',
    Equal: 'equal',
    BracketLeft: 'left.bracket',
    BracketRight: 'right.bracket',
    Backslash: 'backslash',
    Semicolon: 'semicolon',
    Quote: 'apostrophe',
    Comma: 'comma',
    Period: 'period',
    Slash: 'slash',
    Backquote: 'grave.accent',
    ShiftLeft: 'left.shift',
    ShiftRight: 'right.shift',
    ControlLeft: 'left.control',
    ControlRight: 'right.control',
    AltLeft: 'left.alt',
    AltRight: 'right.alt',
    MetaLeft: 'left.win',
    MetaRight: 'right.win',
    NumpadDecimal: 'keypad.decimal',
    NumpadDivide: 'keypad.divide',
    NumpadMultiply: 'keypad.multiply',
    NumpadSubtract: 'keypad.subtract',
    NumpadAdd: 'keypad.add',
    NumpadEqual: 'keypad.equal'
  };
  if (simple[code]) return `key.keyboard.${simple[code]}`;
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return `key.keyboard.${letter[1].toLowerCase()}`;
  const digit = code.match(/^Digit(\d)$/);
  if (digit) return `key.keyboard.${digit[1]}`;
  const numpad = code.match(/^Numpad(\d)$/);
  if (numpad) return `key.keyboard.keypad.${numpad[1]}`;
  const fn = code.match(/^F(\d{1,2})$/);
  if (fn) return `key.keyboard.f${fn[1]}`;
  return null;
}

/** Клавиша из номера кнопки мыши (DOM MouseEvent.button). */
export function keySpecFromMouse(button: number): string | null {
  if (button === 0) return 'key.mouse.left';
  if (button === 1) return 'key.mouse.middle';
  if (button === 2) return 'key.mouse.right';
  if (button >= 3 && button <= 8) return `key.mouse.${button}`;
  return null;
}