import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";

const DEFAULT_DEV_SERVER_URL = "http://localhost:4000";
const APP_NAME = "LiquiTask";
const MAX_WORKSPACE_SEARCH_RESULTS = 20;
const MAX_WORKSPACE_FILE_SIZE_BYTES = 256 * 1024;

let mainWindow: BrowserWindow | null = null;

// Single Instance Protection
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const getStorageFilePath = () => {
  return path.join(app.getPath("userData"), "electron-store.json");
};

const readStorage = async (): Promise<Record<string, unknown>> => {
  try {
    const raw = await fs.readFile(getStorageFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

const writeStorage = async (data: Record<string, unknown>) => {
  await fs.mkdir(path.dirname(getStorageFilePath()), { recursive: true });
  await fs.writeFile(getStorageFilePath(), JSON.stringify(data, null, 2), "utf8");
};

const emitWindowState = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("windowStateChanged", {
      isMaximized: mainWindow.isMaximized(),
    });
  }
};

function createWindow() {
  const isDev = process.env.NODE_ENV === "development";
  const preloadPath = path.join(__dirname, "preload.cjs");
  const iconPath = path.join(__dirname, isDev ? "../build/icon.png" : "../build/icon.png"); // Standardize or adjust based on build structure

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    x: 80,
    y: 80,
    title: APP_NAME,
    icon: iconPath,
    show: false, // Ready-to-show logic
    titleBarStyle: "hidden",
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
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Ready-to-show logic: prevents the "white flash"
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("resize", emitWindowState);
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC Handlers with Guards
ipcMain.on("minimizeWindow", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on("maximizeWindow", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    emitWindowState();
  }
});

ipcMain.on("restoreWindow", () => {
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

ipcMain.on("closeWindow", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle("isWindowMaximized", () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
});

ipcMain.handle("storageGet", async (_, key: string) => {
  const data = await readStorage();
  return data[key];
});

ipcMain.handle("storageSet", async (_, key: string, value: unknown) => {
  const data = await readStorage();
  data[key] = value;
  await writeStorage(data);
});

ipcMain.handle("storageDelete", async (_, key: string) => {
  const data = await readStorage();
  delete data[key];
  await writeStorage(data);
});

ipcMain.handle("storageClear", async () => {
  await writeStorage({});
});

ipcMain.handle("storageHas", async (_, key: string) => {
  const data = await readStorage();
  return Object.hasOwn(data, key);
});

// Workspace IPC Handlers
ipcMain.handle("selectWorkspaceDirectory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Workspace Directory",
    buttonLabel: "Select Folder",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("getWorkspacePaths", async () => {
  const data = await readStorage();
  return (data.workspacePaths as string[]) || [];
});

ipcMain.handle("setWorkspacePaths", async (_, paths: string[]) => {
  const data = await readStorage();
  data.workspacePaths = paths;
  await writeStorage(data);
});

const isPathAuthorized = (filePath: string, authorizedPaths: string[]) => {
  const normalizedPath = path.normalize(filePath);
  const isCaseInsensitive = process.platform === "win32";

  return authorizedPaths.some((p) => {
    const authorized = path.normalize(p);
    const a = isCaseInsensitive ? authorized.toLowerCase() : authorized;
    const b = isCaseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;

    // Exact match or within directory (matching directory boundary)
    return b === a || b.startsWith(a + path.sep);
  });
};

const resolveWorkspaceScope = (authorizedPaths: string[], requestedScopePaths?: string[]) => {
  if (requestedScopePaths === undefined) {
    return authorizedPaths;
  }

  if (requestedScopePaths.length === 0) {
    return [];
  }

  return requestedScopePaths.filter((scopePath) => isPathAuthorized(scopePath, authorizedPaths));
};

const isMarkdownFile = (filePath: string) => path.extname(filePath).toLowerCase() === ".md";

const createSnippet = (content: string, query: string) => {
  const normalizedContent = content.replace(/\s+/g, " ").trim();
  if (!normalizedContent) {
    return "Empty markdown file";
  }

  const lowerContent = normalizedContent.toLowerCase();
  const matchIndex = lowerContent.indexOf(query);
  if (matchIndex === -1) {
    return normalizedContent.slice(0, 180);
  }

  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(normalizedContent.length, matchIndex + query.length + 80);
  return normalizedContent.slice(start, end);
};

ipcMain.handle("readWorkspaceFile", async (_, filePath: string, requestedScopePaths?: string[]) => {
  const data = await readStorage();
  const paths = resolveWorkspaceScope((data.workspacePaths as string[]) || [], requestedScopePaths);

  if (!isMarkdownFile(filePath)) {
    throw new Error(`Workspace file reads are limited to markdown files: ${filePath}`);
  }

  if (!isPathAuthorized(filePath, paths)) {
    throw new Error(`Unauthorized access to file: ${filePath}`);
  }

  return fs.readFile(path.normalize(filePath), "utf-8");
});

ipcMain.handle(
  "writeWorkspaceFile",
  async (_, filePath: string, content: string, requestedScopePaths?: string[]) => {
    const data = await readStorage();
    const paths = resolveWorkspaceScope(
      (data.workspacePaths as string[]) || [],
      requestedScopePaths,
    );

    if (!isMarkdownFile(filePath)) {
      throw new Error(`Workspace file writes are limited to markdown files: ${filePath}`);
    }

    if (!isPathAuthorized(filePath, paths)) {
      throw new Error(`Unauthorized write access to file: ${filePath}`);
    }

    await fs.writeFile(path.normalize(filePath), content, "utf-8");
  },
);

async function findMarkdownMatches(
  dir: string,
  query: string,
  results: Array<{ path: string; snippet: string }> = [],
) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_WORKSPACE_SEARCH_RESULTS) {
        return results;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await findMarkdownMatches(fullPath, query, results);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const normalizedQuery = query.toLowerCase();
        const filenameMatches = entry.name.toLowerCase().includes(normalizedQuery);

        if (filenameMatches) {
          results.push({
            path: fullPath,
            snippet: `Filename match: ${entry.name}`,
          });
          continue;
        }

        const stats = await fs.stat(fullPath);
        if (stats.size > MAX_WORKSPACE_FILE_SIZE_BYTES) {
          continue;
        }

        const content = await fs.readFile(fullPath, "utf-8");
        if (content.toLowerCase().includes(normalizedQuery)) {
          results.push({
            path: fullPath,
            snippet: createSnippet(content, normalizedQuery),
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error searching directory ${dir}:`, err);
  }
  return results;
}

ipcMain.handle("searchWorkspaceFiles", async (_, query: string, requestedScopePaths?: string[]) => {
  const data = await readStorage();
  const paths = resolveWorkspaceScope((data.workspacePaths as string[]) || [], requestedScopePaths);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const allResults: Array<{ path: string; snippet: string }> = [];

  for (const workspacePath of paths) {
    if (allResults.length >= MAX_WORKSPACE_SEARCH_RESULTS) {
      break;
    }
    await findMarkdownMatches(path.normalize(workspacePath), normalizedQuery, allResults);
  }

  return allResults;
});

ipcMain.on("showNotification", (_, options: { title: string; body: string; silent?: boolean }) => {
  if (!Notification.isSupported()) return;

  new Notification({
    title: options.title,
    body: options.body,
    silent: options.silent,
  }).show();
});
