import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type RuntimeKind = "web" | "electron" | "tauri";

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

const isBrowser = typeof window !== "undefined";

/**
 * Detect the Tauri runtime. Tauri 2 injects `__TAURI_INTERNALS__` into every
 * webview regardless of the `withGlobalTauri` setting; `isTauri` is also set on
 * recent versions. We check both so detection is robust across point releases.
 */
const isTauriRuntime = (): boolean => {
  if (!isBrowser) return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; isTauri?: boolean };
  return typeof w.__TAURI_INTERNALS__ !== "undefined" || w.isTauri === true;
};

/**
 * Build the desktop bridge backed by Tauri commands + plugins. The shape is
 * identical to the former Electron preload bridge so no consumer needs to know
 * which desktop runtime is hosting it.
 */
const buildTauriDesktopApi = (): DesktopAPI => {
  const appWindow = getCurrentWindow();
  const stateListeners = new Set<(isMaximized: boolean) => void>();
  let lastMaximized: boolean | null = null;

  // Tauri has no dedicated "maximize changed" event, so derive it from resize.
  void appWindow.onResized(async () => {
    try {
      const maximized = await appWindow.isMaximized();
      if (maximized !== lastMaximized) {
        lastMaximized = maximized;
        stateListeners.forEach((listener) => {
          listener(maximized);
        });
      }
    } catch {
      // Window may be closing — ignore.
    }
  });

  return {
    minimize: () => appWindow.minimize(),
    maximize: () => appWindow.maximize(),
    restore: () => appWindow.unmaximize(),
    close: () => appWindow.close(),
    isMaximized: () => appWindow.isMaximized(),
    onWindowStateChange: (callback) => {
      stateListeners.add(callback);
      return () => {
        stateListeners.delete(callback);
      };
    },
    showNotification: async ({ title, body, silent }) => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        if (granted) {
          sendNotification({
            title: title.slice(0, 256),
            body: body.slice(0, 1024),
            silent,
          });
        }
      } catch (err) {
        console.error("Failed to show notification:", err);
      }
    },
    storage: {
      get: (key) =>
        invoke<unknown>("storage_get", { key }).catch((err) => {
          console.error(`Failed to get storage key "${key}":`, err);
          return undefined;
        }),
      set: (key, value) =>
        invoke<void>("storage_set", { key, value }).catch((err) => {
          console.error(`Failed to set storage key "${key}":`, err);
        }),
      delete: (key) =>
        invoke<void>("storage_delete", { key }).catch((err) => {
          console.error(`Failed to delete storage key "${key}":`, err);
        }),
      clear: () =>
        invoke<void>("storage_clear").catch((err) => {
          console.error("Failed to clear storage:", err);
        }),
      has: (key) =>
        invoke<boolean>("storage_has", { key }).catch((err) => {
          console.error(`Failed to check storage key "${key}":`, err);
          return false;
        }),
    },
    workspace: {
      selectDirectory: async () => {
        const selected = await openDialog({
          directory: true,
          multiple: false,
          title: "Select Workspace Directory",
        });
        return typeof selected === "string" ? selected : null;
      },
      getPaths: () =>
        invoke<string[]>("workspace_get_paths").catch((err) => {
          console.error("Failed to get workspace paths:", err);
          return [];
        }),
      setPaths: (paths) =>
        invoke<void>("workspace_set_paths", { paths }).catch((err) => {
          console.error("Failed to set workspace paths:", err);
        }),
      readFile: (filePath, scopePaths) =>
        invoke<string>("workspace_read_file", { filePath, scopePaths }).catch((err) => {
          console.error(`Failed to read workspace file "${filePath}":`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }),
      writeFile: (filePath, content, scopePaths) =>
        invoke<void>("workspace_write_file", { filePath, content, scopePaths }).catch((err) => {
          console.error(`Failed to write workspace file "${filePath}":`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }),
      searchFiles: (query, scopePaths) =>
        invoke<WorkspaceSearchResult[]>("workspace_search_files", { query, scopePaths }).catch(
          (err) => {
            console.error("Failed to search workspace files:", err);
            throw err instanceof Error ? err : new Error(String(err));
          },
        ),
    },
  };
};

export const initializeDesktopBridge = () => {
  if (!isBrowser) return;

  // Under Tauri, construct the bridge from Tauri APIs and publish it on the
  // same globals the rest of the app already reads.
  if (isTauriRuntime() && !window.desktopAPI) {
    const api = buildTauriDesktopApi();
    window.desktopAPI = api;
    window.electronAPI = api;
    return;
  }

  // Electron (or any preload-injected bridge): mirror it onto desktopAPI.
  const desktopAPI = getDesktopApi();
  if (desktopAPI) {
    window.desktopAPI = desktopAPI;
    window.electronAPI = desktopAPI;
  }
};

export const getDesktopApi = (): DesktopAPI | undefined => {
  if (!isBrowser) return undefined;
  return window.desktopAPI ?? window.electronAPI;
};

const hasDesktopAPI = () => {
  return Boolean(getDesktopApi());
};

export const getRuntimeKind = (): RuntimeKind => {
  if (isTauriRuntime()) {
    return "tauri";
  }

  if (hasDesktopAPI()) {
    return "electron";
  }

  return "web";
};

export const isElectron = () => getRuntimeKind() === "electron";
export const isTauri = () => getRuntimeKind() === "tauri";
export const isWeb = () => getRuntimeKind() === "web";
export const isDesktop = () => !isWeb();

export const getRuntimeState = (): RuntimeState => ({
  kind: getRuntimeKind(),
  hasCustomWindowControls: Boolean(getDesktopApi()),
});

export const getRuntimeWindowControls = (): RuntimeWindowControls | null => {
  if (!isBrowser) return null;

  const desktopAPI = getDesktopApi();
  if (desktopAPI) {
    return {
      minimize: async () => {
        await desktopAPI.minimize();
      },
      maximize: async () => {
        await desktopAPI.maximize();
      },
      restore: async () => {
        await desktopAPI.restore();
      },
      close: async () => {
        await desktopAPI.close();
      },
      isMaximized: async () => {
        return Boolean(await desktopAPI.isMaximized());
      },
      onWindowStateChange: (callback) => desktopAPI.onWindowStateChange(callback),
    };
  }

  return null;
};

export const getNativeStorageApi = () => {
  const desktopAPI = getDesktopApi();
  if (desktopAPI) {
    return desktopAPI.storage;
  }
};

/**
 * Reveal the window once the renderer has mounted. The Tauri window is created
 * hidden (`visible: false`) to avoid a white flash, mirroring the Electron
 * ready-to-show behaviour. No-op everywhere else; intentionally returns void
 * synchronously so existing `await showRuntimeWindow()` callers keep working.
 */
export const showRuntimeWindow = (): void => {
  if (!isTauriRuntime()) return;
  void (async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
    } catch (err) {
      console.error("Failed to show window:", err);
    }
  })();
};
