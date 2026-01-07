import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods for window controls
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

    // Platform info
    platform: process.platform,

    // App info
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron
    },

    // Notifications
    showNotification: (options: { title: string; body: string }) =>
        ipcRenderer.invoke('notification:show', options),
});
