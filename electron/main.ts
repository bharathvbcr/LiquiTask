import { app, BrowserWindow, ipcMain, shell, Menu, Notification } from 'electron';
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
            preload: join(__dirname, '../preload/preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        },
        show: false, // Show when ready
        icon: join(__dirname, '../build/icon.png')
    });

    // Graceful window show
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Load app
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
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
