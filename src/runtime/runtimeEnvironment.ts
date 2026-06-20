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

export const initializeDesktopBridge = () => {
  const desktopAPI = getDesktopApi();
  if (isBrowser && desktopAPI) {
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
  if (hasDesktopAPI()) {
    return "electron";
  }

  return "web";
};

export const isElectron = () => getRuntimeKind() === "electron";
export const isTauri = () => false;
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

export const showRuntimeWindow = () => {
  // No-op since Tauri window showing is removed and Electron loads automatically
};
