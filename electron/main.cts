import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Notification, session } from "electron";

const DEFAULT_DEV_SERVER_URL = "http://localhost:4000";
const APP_NAME = "LiquiTask";
const MAX_WORKSPACE_SEARCH_RESULTS = 20;
const MAX_WORKSPACE_FILE_SIZE_BYTES = 256 * 1024;
const MAX_STORAGE_SIZE_BYTES = 10_000_000;
const SUPPORTED_WORKSPACE_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".cts",
  ".astro",
  ".cfg",
  ".conf",
  ".dart",
  ".go",
  ".gradle",
  ".gql",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".php",
  ".properties",
  ".ps1",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);
const SUPPORTED_WORKSPACE_FILE_NAMES = new Set([
  ".dockerignore",
  ".gitignore",
  "dockerfile",
  "makefile",
  "procfile",
]);
const SKIPPED_WORKSPACE_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".turbo",
  ".vite",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules",
  "out",
  "release",
]);

// Dangerous prototype keys that must never be used as storage keys
const FORBIDDEN_STORAGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Regex for valid storage keys
const VALID_STORAGE_KEY_RE = /^[a-zA-Z0-9_:\-.]{1,256}$/;

// Write queue to serialise all mutating storage operations (fix #1)
let writeQueue: Promise<void> = Promise.resolve();

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
    // Use Object.create(null) to avoid inherited prototype keys (fix #4)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const store = Object.create(null) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        store[k] = v;
      }
      return store;
    }
    return Object.create(null) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return Object.create(null) as Record<string, unknown>;
    }
    throw error;
  }
};

const writeStorage = async (data: Record<string, unknown>) => {
  // Guard against excessively large storage (fix #4)
  const serialised = JSON.stringify(data, null, 2);
  if (serialised.length > MAX_STORAGE_SIZE_BYTES) {
    throw new Error("Storage size limit exceeded");
  }
  await fs.mkdir(path.dirname(getStorageFilePath()), { recursive: true });
  await fs.writeFile(getStorageFilePath(), serialised, "utf8");
};

/** Validate a renderer-supplied storage key (fix #4) */
const validateStorageKey = (key: unknown): string => {
  if (typeof key !== "string") throw new Error("Storage key must be a string");
  if (!VALID_STORAGE_KEY_RE.test(key)) throw new Error(`Invalid storage key: ${key}`);
  if (FORBIDDEN_STORAGE_KEYS.has(key)) throw new Error(`Forbidden storage key: ${key}`);
  return key;
};

/** Verify that the IPC message originates from the trusted renderer (fix #8) */
const assertTrustedSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
  const isDev = process.env.NODE_ENV === "development";
  try {
    const senderUrl = new URL(event.senderFrame?.url ?? "");
    const isAllowed = isDev
      ? senderUrl.hostname === "localhost"
      : senderUrl.protocol === "file:";
    if (!isAllowed) throw new Error("Untrusted sender");
  } catch (err) {
    // If URL parsing fails, the sender is not trusted
    throw new Error("Untrusted sender");
  }
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

  // Set Content-Security-Policy on all responses (fix #2)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://generativelanguage.googleapis.com",
        ],
      },
    });
  });

  // Navigation guard: prevent the renderer from navigating to external URLs (fix #3)
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsedUrl = new URL(url);
      const allowed = isDev
        ? parsedUrl.hostname === "localhost"
        : parsedUrl.protocol === "file:";
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  // Deny all new-window requests (fix #3)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || DEFAULT_DEV_SERVER_URL;
    mainWindow.loadURL(devUrl);
    // Only open DevTools when actually running in dev mode and not packaged (fix #10)
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools();
    }
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

ipcMain.handle("storageGet", async (event, key: string) => {
  assertTrustedSender(event); // fix #8
  const validKey = validateStorageKey(key); // fix #4
  const data = await readStorage();
  return data[validKey];
});

ipcMain.handle("storageSet", async (event, key: string, value: unknown) => {
  assertTrustedSender(event); // fix #8
  const validKey = validateStorageKey(key); // fix #4

  // Serialise all mutating writes through the write queue (fix #1)
  writeQueue = writeQueue.then(async () => {
    const data = await readStorage();
    data[validKey] = value;
    await writeStorage(data);
  });
  await writeQueue;
});

ipcMain.handle("storageDelete", async (event, key: string) => {
  assertTrustedSender(event); // fix #8
  const validKey = validateStorageKey(key); // fix #4

  // Serialise all mutating writes through the write queue (fix #1)
  writeQueue = writeQueue.then(async () => {
    const data = await readStorage();
    delete data[validKey];
    await writeStorage(data);
  });
  await writeQueue;
});

ipcMain.handle("storageClear", async (event) => {
  assertTrustedSender(event); // fix #8

  // Serialise through the write queue (fix #1)
  writeQueue = writeQueue.then(async () => {
    await writeStorage(Object.create(null) as Record<string, unknown>);
  });
  await writeQueue;
});

ipcMain.handle("storageHas", async (event, key: string) => {
  assertTrustedSender(event); // fix #8
  const validKey = validateStorageKey(key); // fix #4
  const data = await readStorage();
  return Object.hasOwn(data, validKey);
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

ipcMain.handle("getWorkspacePaths", async (event) => {
  assertTrustedSender(event); // fix #8
  const data = await readStorage();
  return (data.workspacePaths as string[]) || [];
});

/** Validate a renderer-supplied workspace path array (fix #5) */
const validateWorkspacePaths = (paths: unknown): string[] => {
  if (!Array.isArray(paths)) throw new Error("workspacePaths must be an array");
  if (paths.length > 20) throw new Error("workspacePaths exceeds maximum of 20 entries");

  return paths.map((p, i) => {
    if (typeof p !== "string") throw new Error(`workspacePaths[${i}] must be a string`);
    if (p.length > 512) throw new Error(`workspacePaths[${i}] path is too long`);
    if (!path.isAbsolute(p)) throw new Error(`workspacePaths[${i}] must be an absolute path`);

    // Reject filesystem root paths
    const normalized = path.normalize(p);
    const parsed = path.parse(normalized);
    if (normalized === parsed.root) {
      throw new Error(`workspacePaths[${i}] must not be the filesystem root`);
    }

    return p;
  });
};

ipcMain.handle("setWorkspacePaths", async (event, paths: string[]) => {
  assertTrustedSender(event); // fix #8
  const validPaths = validateWorkspacePaths(paths); // fix #5

  // Serialise through the write queue (fix #1)
  writeQueue = writeQueue.then(async () => {
    const data = await readStorage();
    data.workspacePaths = validPaths;
    await writeStorage(data);
  });
  await writeQueue;
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

const isWorkspaceTextFile = (filePath: string) => {
  const fileName = path.basename(filePath).toLowerCase();
  if (SUPPORTED_WORKSPACE_FILE_NAMES.has(fileName)) return true;
  return SUPPORTED_WORKSPACE_FILE_EXTENSIONS.has(path.extname(fileName));
};

const isSkippedWorkspaceDirectory = (dirName: string) =>
  SKIPPED_WORKSPACE_DIR_NAMES.has(dirName.toLowerCase());

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

ipcMain.handle("readWorkspaceFile", async (event, filePath: string, requestedScopePaths?: string[]) => {
  assertTrustedSender(event); // fix #8
  const data = await readStorage();
  const paths = resolveWorkspaceScope((data.workspacePaths as string[]) || [], requestedScopePaths);

  if (!isWorkspaceTextFile(filePath)) {
    throw new Error(`Workspace file reads are limited to supported text/source files: ${filePath}`);
  }

  if (!isPathAuthorized(filePath, paths)) {
    throw new Error(`Unauthorized access to file: ${filePath}`);
  }

  // Resolve symlinks to canonical path before final read to prevent symlink escapes (fix #6)
  const resolvedPath = await fs.realpath(filePath);
  if (!isPathAuthorized(resolvedPath, paths)) {
    throw new Error(`Unauthorized access to resolved file path: ${resolvedPath}`);
  }

  const stats = await fs.stat(resolvedPath);
  if (stats.size > MAX_WORKSPACE_FILE_SIZE_BYTES) {
    throw new Error(`Workspace file is too large to read safely: ${filePath}`);
  }

  return fs.readFile(resolvedPath, "utf-8");
});

ipcMain.handle(
  "writeWorkspaceFile",
  async (event, filePath: string, content: string, requestedScopePaths?: string[]) => {
    assertTrustedSender(event); // fix #8
    const data = await readStorage();
    const paths = resolveWorkspaceScope(
      (data.workspacePaths as string[]) || [],
      requestedScopePaths,
    );

    if (!isWorkspaceTextFile(filePath)) {
      throw new Error(
        `Workspace file writes are limited to supported text/source files: ${filePath}`,
      );
    }

    if (!isPathAuthorized(filePath, paths)) {
      throw new Error(`Unauthorized write access to file: ${filePath}`);
    }

    if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_FILE_SIZE_BYTES) {
      throw new Error(`Workspace file is too large to write safely: ${filePath}`);
    }

    // Resolve the parent directory via realpath, then reconstruct the target
    // path. For files that do not exist yet, resolve the parent directory. (fix #6)
    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(filePath);
    } catch {
      // File doesn't exist yet — resolve the parent directory
      const parent = await fs.realpath(path.dirname(filePath));
      resolvedPath = path.join(parent, path.basename(filePath));
    }

    if (!isPathAuthorized(resolvedPath, paths)) {
      throw new Error(`Unauthorized write access to resolved file path: ${resolvedPath}`);
    }

    await fs.writeFile(resolvedPath, content, "utf-8");
  },
);

async function findWorkspaceFileMatches(
  dir: string,
  query: string,
  results: Array<{ path: string; snippet: string }> = [],
  visited: Set<string> = new Set(), // fix #11: track visited real paths to detect cycles
) {
  try {
    // Resolve symlinks before recursing to detect directory cycles (fix #11)
    const realDir = await fs.realpath(dir);
    if (visited.has(realDir)) return results;
    visited.add(realDir);

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_WORKSPACE_SEARCH_RESULTS) {
        return results;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isSkippedWorkspaceDirectory(entry.name)) {
          continue;
        }
        await findWorkspaceFileMatches(fullPath, query, results, visited);
      } else if (entry.isFile() && isWorkspaceTextFile(fullPath)) {
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

ipcMain.handle("searchWorkspaceFiles", async (event, query: string, requestedScopePaths?: string[]) => {
  assertTrustedSender(event); // fix #8
  const data = await readStorage();
  const paths = resolveWorkspaceScope((data.workspacePaths as string[]) || [], requestedScopePaths);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const allResults: Array<{ path: string; snippet: string }> = [];
  const visited = new Set<string>(); // shared across all workspace roots

  for (const workspacePath of paths) {
    if (allResults.length >= MAX_WORKSPACE_SEARCH_RESULTS) {
      break;
    }
    await findWorkspaceFileMatches(path.normalize(workspacePath), normalizedQuery, allResults, visited);
  }

  return allResults;
});

ipcMain.on("showNotification", (event, options: { title: string; body: string; silent?: boolean }) => {
  assertTrustedSender(event); // fix #8

  // Validate and sanitise title/body before constructing Notification (fix #7)
  if (typeof options?.title !== "string" || typeof options?.body !== "string") return;
  const title = options.title.slice(0, 256);
  const body = options.body.slice(0, 1024);

  if (!Notification.isSupported()) return;

  new Notification({
    title,
    body,
    silent: options.silent,
  }).show();
});
