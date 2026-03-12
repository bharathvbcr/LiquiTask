import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';

const DEFAULT_DEV_SERVER_URL = 'http://localhost:3000';
const APP_NAME = 'LiquiTask';

let mainWindow: BrowserWindow | null = null;

// Single Instance Protection
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const getStorageFilePath = () => {
  return path.join(app.getPath('userData'), 'electron-store.json');
};

const readStorage = async (): Promise<Record<string, unknown>> => {
  try {
    const raw = await fs.readFile(getStorageFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const writeStorage = async (data: Record<string, unknown>) => {
  await fs.mkdir(path.dirname(getStorageFilePath()), { recursive: true });
  await fs.writeFile(getStorageFilePath(), JSON.stringify(data, null, 2), 'utf8');
};

const emitWindowState = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('windowStateChanged', {
      isMaximized: mainWindow.isMaximized(),
    });
  }
};

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development';
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const iconPath = path.join(__dirname, isDev ? '../build/icon.png' : '../build/icon.png'); // Standardize or adjust based on build structure

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    x: 80,
    y: 80,
    title: APP_NAME,
    icon: iconPath,
    show: false, // Ready-to-show logic
    titleBarStyle: 'hidden',
    transparent: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || DEFAULT_DEV_SERVER_URL;
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Ready-to-show logic: prevents the "white flash"
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('resize', emitWindowState);
  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers with Guards
ipcMain.on('minimizeWindow', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('maximizeWindow', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    emitWindowState();
  }
});

ipcMain.on('restoreWindow', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else if (mainWindow.isMinimized()) {
      mainWindow.restore();
    } else {
      mainWindow.maximize();
    }
    emitWindowState();
  }
});

ipcMain.on('closeWindow', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('isWindowMaximized', () => {
  return (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.isMaximized() : false;
});

ipcMain.handle('storageGet', async (_, key: string) => {
  const data = await readStorage();
  return data[key];
});

ipcMain.handle('storageSet', async (_, key: string, value: unknown) => {
  const data = await readStorage();
  data[key] = value;
  await writeStorage(data);
});

ipcMain.handle('storageDelete', async (_, key: string) => {
  const data = await readStorage();
  delete data[key];
  await writeStorage(data);
});

ipcMain.handle('storageClear', async () => {
  await writeStorage({});
});

ipcMain.handle('storageHas', async (_, key: string) => {
  const data = await readStorage();
  return Object.prototype.hasOwnProperty.call(data, key);
});

ipcMain.on('showNotification', (_, options: { title: string; body: string; silent?: boolean }) => {
  if (!Notification.isSupported()) return;
  
  new Notification({
    title: options.title,
    body: options.body,
    silent: options.silent,
  }).show();
});
