export type RuntimeKind = 'web' | 'electrobun';

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

const hasElectrobunBridge = () => {
    if (!isBrowser) return false;
    const anyWindow = window as Window & {
        __electrobun?: unknown;
    };
    return Boolean(anyWindow.__electrobun);
};

export const getRuntimeKind = (): RuntimeKind => {
    if (hasElectrobunBridge()) {
        return 'electrobun';
    }

    return 'web';
};

export const isElectrobun = () => getRuntimeKind() === 'electrobun';
export const isWeb = () => getRuntimeKind() === 'web';

export const getRuntimeState = (): RuntimeState => ({
    kind: getRuntimeKind(),
    hasCustomWindowControls: isElectrobun(),
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

    return null;
};

export const getNativeStorageApi = () => {
    const electrobunAPI = getElectrobunAPI();
    if (electrobunAPI) {
        return electrobunAPI.storage;
    }
};
