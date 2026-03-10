export type RuntimeKind = 'web' | 'electron' | 'electrobun';

export interface RuntimeState {
    kind: RuntimeKind;
    hasCustomWindowControls: boolean;
}

export interface RuntimeWindowControls {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    restore: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;
}

const isBrowser = typeof window !== 'undefined';

const getElectrobunAPI = () => {
    return isBrowser && (window as Window & { electrobunAPI?: unknown }).electrobunAPI
        ? (window as Window & { electrobunAPI: ElectrobunAPI }).electrobunAPI
        : undefined;
};

const getElectronAPI = () => {
    return isBrowser && (window as Window & { electronAPI?: unknown }).electronAPI
        ? (window as Window & { electronAPI: ElectronAPI }).electronAPI
        : undefined;
};

const hasElectrobunBridge = () => {
    if (!isBrowser) return false;
    const anyWindow = window as Window & {
        __electrobun?: unknown;
    };
    return Boolean(anyWindow.__electrobun);
};

export const getRuntimeKind = (): RuntimeKind => {
    if (getElectronAPI()) {
        return 'electron';
    }

    if (hasElectrobunBridge()) {
        return 'electrobun';
    }

    return 'web';
};

export const isElectron = () => getRuntimeKind() === 'electron';
export const isElectrobun = () => getRuntimeKind() === 'electrobun';
export const isWeb = () => getRuntimeKind() === 'web';

export const getRuntimeState = (): RuntimeState => ({
    kind: getRuntimeKind(),
    hasCustomWindowControls: isElectron() || isElectrobun(),
});

export const getRuntimeWindowControls = (): RuntimeWindowControls | null => {
    if (!isBrowser) return null;

    const electrobunAPI = getElectrobunAPI();
    if (electrobunAPI) {
        return {
            minimize: async () => {
                await electrobunAPI.minimize();
            },
            maximize: async () => {
                await electrobunAPI.maximize();
            },
            restore: async () => {
                await electrobunAPI.restore();
            },
            close: async () => {
                await electrobunAPI.close();
            },
            isMaximized: async () => {
                return Boolean(await electrobunAPI.isMaximized());
            },
            onWindowStateChange: (callback) => electrobunAPI.onWindowStateChange(callback),
        };
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI) return null;

    return {
        minimize: async () => {
            await electronAPI.minimize?.();
        },
        maximize: async () => {
            await electronAPI.maximize?.();
        },
        restore: async () => {
            await electronAPI.isMaximized?.().then((maximized: boolean) => {
                if (maximized) {
                    electronAPI.unmaximize?.();
                } else {
                    electronAPI.maximize?.();
                }
            });
        },
        close: async () => {
            await electronAPI.close?.();
        },
        isMaximized: async () => {
            if (!electronAPI.isMaximized) return false;
            return Boolean(await electronAPI.isMaximized());
        },
        onWindowStateChange: (callback) => {
            const unsubs: Array<(() => void) | undefined> = [];
            if (electronAPI.on) {
                const offMax = electronAPI.on('maximize', () => callback(true));
                const offUnmax = electronAPI.on('unmaximize', () => callback(false));
                if (offMax) unsubs.push(offMax);
                if (offUnmax) unsubs.push(offUnmax);
            }
            return () => {
                unsubs.forEach(unsub => unsub?.());
            };
        },
    };
};

export const getNativeStorageApi = () => {
    const electrobunAPI = getElectrobunAPI();
    if (electrobunAPI) {
        return electrobunAPI.storage;
    }

    const electronAPI = getElectronAPI();
    return electronAPI?.storage;
};
