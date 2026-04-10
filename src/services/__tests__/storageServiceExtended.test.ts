import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../constants";
import { indexedDBService } from "../indexedDBService";
import { migrationService } from "../migrationService";
import { storageService } from "../storageService";

// Simple localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
  };
})();

// Mock dependencies
vi.mock("../indexedDBService", () => ({
  indexedDBService: {
    isAvailable: vi.fn().mockReturnValue(true),
    saveTasks: vi.fn().mockResolvedValue(undefined),
    saveProject: vi.fn().mockResolvedValue(undefined),
    saveColumns: vi.fn().mockResolvedValue(undefined),
    savePriorities: vi.fn().mockResolvedValue(undefined),
    saveCustomFields: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../migrationService", () => ({
  migrationService: {
    needsMigration: vi.fn().mockReturnValue(false),
    runMigrations: vi.fn(),
  },
  CURRENT_DATA_VERSION: "2.0.0",
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  getNativeStorageApi: vi.fn().mockReturnValue(null),
}));

describe("StorageService Extended", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", localStorageMock);
    localStorage.clear();
    (storageService as any).cache.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should save to IndexedDB when setting tasks/projects", async () => {
    const tasks = [{ id: "1", title: "T1" }] as any;
    storageService.set(STORAGE_KEYS.TASKS, tasks);
    expect(indexedDBService.saveTasks).toHaveBeenCalledWith(tasks);

    const projects = [{ id: "p1", name: "P1" }] as any;
    storageService.set(STORAGE_KEYS.PROJECTS, projects);
    expect(indexedDBService.saveProject).toHaveBeenCalled();
  });

  it("should run migrations during initialize if needed", async () => {
    vi.mocked(migrationService.needsMigration).mockReturnValue(true);
    vi.mocked(migrationService.runMigrations).mockReturnValue({
      success: true,
      data: { version: "2.0.0", tasks: [] } as any,
      migratedFrom: "1.0.0",
      migratedTo: "2.0.0",
    });

    // Mock getAllData to return old version
    vi.spyOn(storageService, "getAllData").mockReturnValue({ version: "1.0.0" } as any);

    // Access private method
    await (storageService as any).runDataMigrations();

    expect(migrationService.runMigrations).toHaveBeenCalled();
  });

  it("should handle native storage fallback in initialize", async () => {
    const { getNativeStorageApi } = await import("../../runtime/runtimeEnvironment");
    const mockNative = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getNativeStorageApi).mockReturnValue(mockNative as any);

    // Set something in localStorage to migrate
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT, JSON.stringify("p1"));

    await storageService.initialize();

    expect(mockNative.get).toHaveBeenCalled();
    expect(mockNative.set).toHaveBeenCalledWith(STORAGE_KEYS.ACTIVE_PROJECT, "p1");
    expect(storageService.get(STORAGE_KEYS.ACTIVE_PROJECT, "")).toBe("p1");
  });

  it("should parse tasks with error logs correctly", () => {
    const rawTasks = [
      {
        id: "1",
        createdAt: new Date().toISOString(),
        errorLogs: [{ timestamp: new Date().toISOString(), message: "Error" }],
      },
    ];
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(rawTasks));

    const tasks = storageService.get(STORAGE_KEYS.TASKS, []);
    expect(tasks[0].errorLogs![0].timestamp).toBeInstanceOf(Date);
  });
});
