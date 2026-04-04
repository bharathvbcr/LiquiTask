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
  workspace: {
    getPaths: () => ipcRenderer.invoke('getWorkspacePaths').catch((err) => {
      console.error('Failed to get workspace paths:', err);
      return [];
    }),
    setPaths: (paths: string[]) => ipcRenderer.invoke('setWorkspacePaths', paths).catch((err) => {
      console.error('Failed to set workspace paths:', err);
    }),
    readFile: (filePath: string) => ipcRenderer.invoke('readWorkspaceFile', filePath).catch((err) => {
      console.error(`Failed to read workspace file "${filePath}":`, err);
      throw err;
    }),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('writeWorkspaceFile', filePath, content).catch((err) => {
      console.error(`Failed to write workspace file "${filePath}":`, err);
      throw err;
    }),
  },
});
