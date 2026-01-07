// TypeScript declarations for Electron API exposed via preload
interface ElectronAPI {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
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
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
        delete: (key: string) => Promise<void>;
        clear: () => Promise<void>;
        has: (key: string) => Promise<boolean>;
    };
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export { };
