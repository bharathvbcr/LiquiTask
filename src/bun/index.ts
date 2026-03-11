import { BrowserWindow, Utils, defineElectrobunRPC } from 'electrobun';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const DEFAULT_DEV_SERVER_URL = 'http://127.0.0.1:3000';
const APP_NAME = 'LiquiTask';

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

const getRendererUrl = () => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL
        || process.env.ELECTROBUN_RENDERER_URL
        || process.env.RENDERER_URL;

    if (devServerUrl) {
        return devServerUrl;
    }

    if (process.env.NODE_ENV === 'development') {
        return DEFAULT_DEV_SERVER_URL;
    }

    return `file://${join(import.meta.dir, '..', 'dist', 'index.html')}`;
};

const getStorageFilePath = () => {
    const appDataBasePath = process.env.APPDATA
        || process.env.XDG_CONFIG_HOME
        || join(homedir(), '.config');

    return join(appDataBasePath, APP_NAME, 'electrobun-store.json');
};

const storageFilePath = getStorageFilePath();

const ensureStorageDir = async () => {
    await mkdir(dirname(storageFilePath), { recursive: true });
};

const readStorage = async (): Promise<Record<string, unknown>> => {
    await ensureStorageDir();

    try {
        const raw = await readFile(storageFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw error;
    }
};

const writeStorage = async (data: Record<string, unknown>) => {
    await ensureStorageDir();
    await writeFile(storageFilePath, JSON.stringify(data, null, 2), 'utf8');
};

const emitWindowState = (windowRef: BrowserWindow) => {
    windowRef.webview.rpc.send.windowStateChanged({
        isMaximized: windowRef.isMaximized(),
    });
};

const rpc = defineElectrobunRPC<LiquiTaskElectrobunRPC, 'bun'>('bun', {
    handlers: {
        requests: {
            minimizeWindow: () => {
                mainWindow.minimize();
            },
            maximizeWindow: () => {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else {
                    mainWindow.maximize();
                }
                emitWindowState(mainWindow);
            },
            restoreWindow: () => {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else if (mainWindow.isMinimized()) {
                    mainWindow.unminimize();
                } else {
                    mainWindow.maximize();
                }
                emitWindowState(mainWindow);
            },
            closeWindow: () => {
                mainWindow.close();
            },
            isWindowMaximized: () => {
                return mainWindow.isMaximized();
            },
            storageGet: async ({ key }) => {
                const data = await readStorage();
                return data[key];
            },
            storageSet: async ({ key, value }) => {
                const data = await readStorage();
                data[key] = value;
                await writeStorage(data);
            },
            storageDelete: async ({ key }) => {
                const data = await readStorage();
                delete data[key];
                await writeStorage(data);
            },
            storageClear: async () => {
                await writeStorage({});
            },
            storageHas: async ({ key }) => {
                const data = await readStorage();
                return Object.prototype.hasOwnProperty.call(data, key);
            },
            showNotification: ({ title, body, silent }) => {
                Utils.showNotification({ title, body, silent });
            },
        },
        messages: {},
    },
});

const ensureWebView2 = () => {
    if (process.platform !== 'win32') return;

    try {
        const checkCmd = `reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv`;
        execFileSync('cmd.exe', ['/c', checkCmd], { stdio: 'ignore' });
        return;
    } catch {
        try {
            const checkCmd2 = `reg query "HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv`;
            execFileSync('cmd.exe', ['/c', checkCmd2], { stdio: 'ignore' });
            return;
        } catch {
            // Not installed, proceed to installer
        }
    }

    console.log("WebView2 Runtime not detected. Running silent bootstrapper...");
    const installerPath = join(import.meta.dir, '..', 'webview2', 'MicrosoftEdgeWebview2Setup.exe');
    
    if (existsSync(installerPath)) {
        try {
            console.log("Starting WebView2 installation... this may take a few minutes as it downloads the runtime.");
            execFileSync(installerPath, ['/silent', '/install'], { stdio: 'inherit' });
            console.log("WebView2 installation completed.");
        } catch (err) {
            console.error("Failed to install WebView2:", err);
        }
    } else {
        console.warn("WebView2 bootstrapper not found at", installerPath);
    }
};

ensureWebView2();

const mainWindow = new BrowserWindow({
    title: APP_NAME,
    url: getRendererUrl(),
    frame: {
        x: 80,
        y: 80,
        width: 1400,
        height: 900,
    },
    titleBarStyle: 'hidden',
    transparent: false,
    renderer: 'native',
    sandbox: false,
    rpc,
});

mainWindow.webview.on('dom-ready', () => {
    emitWindowState(mainWindow);
});

mainWindow.on('resize', () => {
    emitWindowState(mainWindow);
});

if (process.env.NODE_ENV === 'development') {
    mainWindow.webview.openDevTools();
}

