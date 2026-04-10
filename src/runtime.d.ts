declare global {
  interface NativeStorageAPI {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    clear: () => Promise<void>;
    has: (key: string) => Promise<boolean>;
  }

  interface WorkspaceSearchResult {
    path: string;
    snippet: string;
  }

  interface WorkspaceAPI {
    selectDirectory: () => Promise<string | null>;
    getPaths: () => Promise<string[]>;
    setPaths: (paths: string[]) => Promise<void>;
    readFile: (filePath: string, scopePaths?: string[]) => Promise<string>;
    writeFile: (filePath: string, content: string, scopePaths?: string[]) => Promise<void>;
    searchFiles: (query: string, scopePaths?: string[]) => Promise<WorkspaceSearchResult[]>;
  }

  interface ElectronAPI {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    restore: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;
    showNotification: (options: { title: string; body: string; silent?: boolean }) => Promise<void>;
    storage: NativeStorageAPI;
    workspace: WorkspaceAPI;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
