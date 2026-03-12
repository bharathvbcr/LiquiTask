import { contextBridge, ipcRenderer } from 'electron';

type WindowStateListener = (isMaximized: boolean) => void;

const listeners = new Set<WindowStateListener>();

ipcRenderer.on('windowStateChanged', (_, { isMaximized }) => {
  listeners.forEach((listener) => listener(isMaximized));
});

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimizeWindow'),
  maximize: () => ipcRenderer.send('maximizeWindow'),
  restore: () => ipcRenderer.send('restoreWindow'),
  close: () => ipcRenderer.send('closeWindow'),
  isMaximized: () => ipcRenderer.invoke('isWindowMaximized'),
  onWindowStateChange: (callback: WindowStateListener) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
  showNotification: (options: { title: string; body: string; silent?: boolean }) =>
    ipcRenderer.send('showNotification', options),
  storage: {
    get: (key: string) => ipcRenderer.invoke('storageGet', key).catch((err) => {
      console.error(`Failed to get storage key "${key}":`, err);
      return undefined;
    }),
    set: (key: string, value: unknown) => ipcRenderer.invoke('storageSet', key, value).catch((err) => {
      console.error(`Failed to set storage key "${key}":`, err);
    }),
    delete: (key: string) => ipcRenderer.invoke('storageDelete', key).catch((err) => {
      console.error(`Failed to delete storage key "${key}":`, err);
    }),
    clear: () => ipcRenderer.invoke('storageClear').catch((err) => {
      console.error('Failed to clear storage:', err);
    }),
    has: (key: string) => ipcRenderer.invoke('storageHas', key).catch((err) => {
      console.error(`Failed to check storage key "${key}":`, err);
      return false;
    }),
  },
});
