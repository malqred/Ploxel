import type { AppInfo, Settings } from '../shared/types';

declare global {
  interface Window {
    ploxel: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, cb: (...args: unknown[]) => void) => () => void;
      platform: string;
      getPathForFile?: (file: File) => string;
    };
  }
}

const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  try {
    return (await window.ploxel.invoke(channel, ...args)) as T;
  } catch (e) {
    // Electron оборачивает ошибки main-процесса в «Error invoking remote method…»,
    // пользователю нужен только смысл.
    const raw = e instanceof Error ? e.message : String(e);
    const clean = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');
    throw new Error(clean);
  }
};
const on = (channel: string, cb: (...args: unknown[]) => void) => window.ploxel.on(channel, cb);

export const api = {
  invoke: call,
  on,
  app: {
    info: () => call<AppInfo>('app:info'),
    chrome: (theme: string, dark: boolean) => call<void>('app:chrome', theme, dark),
    minimize: () => call<void>('window:minimize')
  },
  settings: {
    get: () => call<Settings>('settings:get'),
    set: (patch: Partial<Settings>) => call<Settings>('settings:set', patch),
    reset: () => call<Settings>('settings:reset'),
    onChange: (cb: (s: Settings) => void) => on('settings:changed', cb as never)
  },
  paths: {
    root: () => call<string>('paths:root'),
    setRoot: (path: string) => call<string>('paths:setRoot', path),
    onChange: (cb: (root: string) => void) => on('paths:changed', cb as never)
  },
  dialog: {
    folder: (title: string) => call<string | null>('dialog:folder', title),
    file: (title: string, filters: { name: string; extensions: string[] }[]) =>
      call<string | null>('dialog:file', title, filters),
    save: (title: string, defaultPath: string, filters: { name: string; extensions: string[] }[]) =>
      call<string | null>('dialog:save', title, defaultPath, filters)
  },
  shell: {
    openPath: (p: string) => call<string>('shell:openPath', p),
    openExternal: (url: string) => call<void>('shell:openExternal', url),
    showItem: (p: string) => call<void>('shell:showItem', p)
  }
};

export type Api = typeof api;