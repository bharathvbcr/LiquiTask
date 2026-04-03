export type RuntimeKind = "web" | "electron";

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

const getElectronAPI = () => {
  return isBrowser && (window as Window & { electronAPI?: unknown }).electronAPI
    ? (window as Window & { electronAPI: ElectronAPI }).electronAPI
    : undefined;
};

const hasElectronAPI = () => {
  if (!isBrowser) return false;
  const anyWindow = window as Window & {
    electronAPI?: unknown;
  };
  return Boolean(anyWindow.electronAPI);
};

export const getRuntimeKind = (): RuntimeKind => {
  if (hasElectronAPI()) {
    return "electron";
  }

  return "web";
};

export const isElectron = () => getRuntimeKind() === "electron";
export const isWeb = () => getRuntimeKind() === "web";

export const getRuntimeState = (): RuntimeState => ({
  kind: getRuntimeKind(),
  hasCustomWindowControls: isElectron(),
});

export const getRuntimeWindowControls = (): RuntimeWindowControls | null => {
  if (!isBrowser) return null;

  const electronAPI = getElectronAPI();
  if (electronAPI) {
    return {
      minimize: async () => {
        await electronAPI.minimize();
      },
      maximize: async () => {
        await electronAPI.maximize();
      },
      restore: async () => {
        await electronAPI.restore();
      },
      close: async () => {
        await electronAPI.close();
      },
      isMaximized: async () => {
        return Boolean(await electronAPI.isMaximized());
      },
      onWindowStateChange: (callback) => electronAPI.onWindowStateChange(callback),
    };
  }

  return null;
};

export const getNativeStorageApi = () => {
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    return electronAPI.storage;
  }
};
