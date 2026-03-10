// TypeScript declarations for Electron API exposed via preload
interface ElectronAPI {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    on: (event: 'maximize' | 'unmaximize', callback: () => void) => (() => void) | undefined;
    platform: NodeJS.Platform;
    versions: {
        node: string;
        chrome: string;
        electron: string;
    };
    // Notifications
    showNotification: (options: { title: string; body: string }) => Promise<void>;
    // Storage
    storage: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<void>;
        delete: (key: string) => Promise<void>;
        clear: () => Promise<void>;
        has: (key: string) => Promise<boolean>;
    };
}

interface NativeStorageAPI {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    clear: () => Promise<void>;
    has: (key: string) => Promise<boolean>;
}

interface ElectrobunAPI {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    restore: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;
    showNotification: (options: { title: string; body: string; silent?: boolean }) => Promise<void>;
    storage: NativeStorageAPI;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
        electrobunAPI?: ElectrobunAPI;
    }
}

export { };
