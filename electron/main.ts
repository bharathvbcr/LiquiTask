import { app, BrowserWindow, ipcMain, shell, Notification } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';

const store = new Store();

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// IPC Handlers for Storage
ipcMain.handle('storage:get', (_event, key) => store.get(key));
ipcMain.handle('storage:set', (_event, key, value) => store.set(key, value));
ipcMain.handle('storage:delete', (_event, key) => store.delete(key));
ipcMain.handle('storage:clear', () => store.clear());
ipcMain.handle('storage:has', (_event, key) => store.has(key));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
    const preloadPath = join(__dirname, '../preload/preload.js');
    const iconPath = join(__dirname, '../build/icon.png');
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        frame: false, // Frameless for modern look
        transparent: false,
        backgroundColor: '#030000', // Match app background
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#0a0505',
            symbolColor: '#ff1f1f',
            height: 40
        },
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        },
        show: false, // Show when ready
        icon: iconPath
    });

    // Graceful window show
    let windowShown = false;
    const showWindow = () => {
        if (!windowShown && mainWindow && !mainWindow.isDestroyed()) {
            windowShown = true;
            mainWindow.show();
            mainWindow.focus();
        }
    };

    mainWindow.once('ready-to-show', () => {
        showWindow();
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Security: Set Content Security Policy headers
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    process.env.VITE_DEV_SERVER_URL
                        ? "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com;"
                        : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com;"
                ]
            }
        });
    });

    // Load app
    // Try to use dev server URL if available, fallback to localhost:5173 in dev mode
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const devServerUrl = process.env.VITE_DEV_SERVER_URL
        || process.env.ELECTRON_VITE_DEV_SERVER_URL
        || (isDev ? 'http://localhost:5173' : null);

    if (devServerUrl) {
        // console.log('[Electron] Loading from dev server:', devServerUrl);
        mainWindow.loadURL(devServerUrl).catch((_err) => {
            // console.error('[Electron] Failed to load dev server URL:', err);
            // Fallback to file if dev server fails
            const filePath = join(__dirname, '../renderer/index.html');
            // console.log('[Electron] Falling back to file:', filePath);
            mainWindow.loadFile(filePath).catch((/* fileErr */) => {
                // console.error('[Electron] Failed to load file:', fileErr);
            });
        });
        // Only open dev tools in development
        if (isDev) {
            mainWindow.webContents.openDevTools();
        }
    } else {
        const filePath = join(__dirname, '../renderer/index.html');
        // console.log('[Electron] Loading from file:', filePath);
        mainWindow.loadFile(filePath).catch((/* err */) => {
            // console.error('[Electron] Failed to load file:', err);
        });
    }

    // Handle load errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        /*
        console.error('[Electron] Failed to load:', {
            errorCode,
            errorDescription,
            validatedURL
        });
        */
        // If dev server fails, try to reload after a short delay
        if (isDev && devServerUrl && validatedURL === devServerUrl) {
            // console.log('[Electron] Retrying dev server load in 2 seconds...');
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.loadURL(devServerUrl).catch((err) => {
                        console.error('[Electron] Retry failed:', err);
                    });
                }
            }, 2000);
        }
    });

    // Fallback: show window if ready-to-show hasn't fired yet
    mainWindow.webContents.on('did-finish-load', () => {
        // console.log('[Electron] Page loaded successfully');
        setTimeout(() => {
            if (!windowShown) {
                showWindow();
            }
        }, 100);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Send window state events to renderer
    mainWindow.on('maximize', () => {
        mainWindow?.webContents.send('window:maximize');
    });
    mainWindow.on('unmaximize', () => {
        mainWindow?.webContents.send('window:unmaximize');
    });
}

// Custom window controls IPC
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

// Notification handler
ipcMain.handle('notification:show', (_event, options: { title: string; body: string }) => {
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: options.title,
            body: options.body,
            icon: join(__dirname, '../build/icon.png'),
        });
        notification.show();
    }
});

// App lifecycle
app.whenReady().then(() => {
    createWindow();

    // macOS dock click behavior
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
