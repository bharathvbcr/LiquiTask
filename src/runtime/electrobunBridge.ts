type WindowStateListener = (isMaximized: boolean) => void;

let initialized = false;

export const initializeElectrobunBridge = async (): Promise<void> => {
    if (initialized || typeof window === 'undefined' || !window.__electrobun) {
        return;
    }

    const { Electroview, defineElectrobunRPC } = await import('electrobun/view');

    type LiquiTaskElectrobunRPC = {
        bun: {
            requests: {
                minimizeWindow: { params: void; response: void };
                maximizeWindow: { params: void; response: void };
                restoreWindow: { params: void; response: void };
                closeWindow: { params: void; response: void };
                isWindowMaximized: { params: void; response: boolean };
                storageGet: { params: { key: string }; response: unknown };
                storageSet: { params: { key: string; value: unknown }; response: void };
                storageDelete: { params: { key: string }; response: void };
                storageClear: { params: void; response: void };
                storageHas: { params: { key: string }; response: boolean };
                showNotification: { params: { title: string; body: string; silent?: boolean }; response: void };
            };
            messages: Record<string, never>;
        };
        webview: {
            requests: Record<string, never>;
            messages: {
                windowStateChanged: { isMaximized: boolean };
            };
        };
    };

    const listeners = new Set<WindowStateListener>();

    const rpc = defineElectrobunRPC<LiquiTaskElectrobunRPC, 'webview'>('webview', {
        handlers: {
            requests: {},
            messages: {
                windowStateChanged: ({ isMaximized }) => {
                    listeners.forEach((listener) => listener(isMaximized));
                },
            },
        },
    });

    new Electroview({ rpc });

    window.electrobunAPI = {
        minimize: () => rpc.request.minimizeWindow(),
        maximize: () => rpc.request.maximizeWindow(),
        restore: () => rpc.request.restoreWindow(),
        close: () => rpc.request.closeWindow(),
        isMaximized: () => rpc.request.isWindowMaximized(),
        onWindowStateChange: (callback) => {
            listeners.add(callback);
            return () => {
                listeners.delete(callback);
            };
        },
        showNotification: (options) => rpc.request.showNotification(options),
        storage: {
            get: (key) => rpc.request.storageGet({ key }),
            set: (key, value) => rpc.request.storageSet({ key, value }),
            delete: (key) => rpc.request.storageDelete({ key }),
            clear: () => rpc.request.storageClear(),
            has: (key) => rpc.request.storageHas({ key }),
        },
    };

    initialized = true;
};

