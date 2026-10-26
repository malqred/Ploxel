import { contextBridge, ipcRenderer, webUtils } from 'electron';

const listeners = new Map<string, (...args: unknown[]) => void>();

contextBridge.exposeInMainWorld('ploxel', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const wrapped = (_e: unknown, ...a: unknown[]) => cb(...a);
    listeners.set(channel, wrapped);
    ipcRenderer.on(channel, wrapped as never);
    return () => {
      ipcRenderer.removeListener(channel, wrapped as never);
      listeners.delete(channel);
    };
  },
  platform: process.platform,
  versions: { app: process.versions.electron },
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
});