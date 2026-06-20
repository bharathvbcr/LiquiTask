import type {
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  Task,
} from "../../types";

const DB_NAME = "LiquiTaskDB";
const DB_VERSION = 1;

interface ObjectStore {
  name: string;
  keyPath: string;
  indexes: Array<{ name: string; keyPath: string; unique?: boolean }>;
}

const OBJECT_STORES: ObjectStore[] = [
  {
    name: "tasks",
    keyPath: "id",
    indexes: [
      { name: "projectId", keyPath: "projectId", unique: false },
      { name: "status", keyPath: "status", unique: false },
      { name: "assignee", keyPath: "assignee", unique: false },
      { name: "priority", keyPath: "priority", unique: false },
      { name: "dueDate", keyPath: "dueDate", unique: false },
      { name: "createdAt", keyPath: "createdAt", unique: false },
    ],
  },
  {
    name: "projects",
    keyPath: "id",
    indexes: [{ name: "parentId", keyPath: "parentId", unique: false }],
  },
  {
    name: "columns",
    keyPath: "id",
    indexes: [],
  },
  {
    name: "priorities",
    keyPath: "id",
    indexes: [],
  },
  {
    name: "customFields",
    keyPath: "id",
    indexes: [],
  },
  {
    name: "projectTypes",
    keyPath: "id",
    indexes: [],
  },
  {
    name: "archivedTasks",
    keyPath: "id",
    indexes: [
      { name: "projectId", keyPath: "projectId", unique: false },
      { name: "completedAt", keyPath: "completedAt", unique: false },
    ],
  },
];

export class IndexedDBService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize IndexedDB
   */
  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        console.warn("IndexedDB not supported, falling back to localStorage");
        resolve();
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        OBJECT_STORES.forEach((storeConfig) => {
          if (!db.objectStoreNames.contains(storeConfig.name)) {
            const store = db.createObjectStore(storeConfig.name, {
              keyPath: storeConfig.keyPath,
            });

            // Create indexes
            storeConfig.indexes.forEach((indexConfig) => {
              if (!store.indexNames.contains(indexConfig.name)) {
                store.createIndex(indexConfig.name, indexConfig.keyPath, {
                  unique: indexConfig.unique || false,
                });
              }
            });
          }
        });
      };
    });

    return this.initPromise;
  }

  /**
   * Check if IndexedDB is available
   */
  isAvailable(): boolean {
    return typeof indexedDB !== "undefined" && this.db !== null;
  }

  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<Task[]> {
    if (!this.db) return [];
    return this.getAll("tasks") as Promise<Task[]>;
  }

  /**
   * Get tasks by project
   */
  async getTasksByProject(projectId: string): Promise<Task[]> {
    if (!this.db) return [];
    const transaction = this.db.transaction(["tasks"], "readonly");
    const store = transaction.objectStore("tasks");
    const index = store.index("projectId");
    const request = index.getAll(projectId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Task[]);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(status: string): Promise<Task[]> {
    if (!this.db) return [];
    const transaction = this.db.transaction(["tasks"], "readonly");
    const store = transaction.objectStore("tasks");
    const index = store.index("status");
    const request = index.getAll(status);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Task[]);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get tasks by assignee
   */
  async getTasksByAssignee(assignee: string): Promise<Task[]> {
    if (!this.db) return [];
    const transaction = this.db.transaction(["tasks"], "readonly");
    const store = transaction.objectStore("tasks");
    const index = store.index("assignee");
    const request = index.getAll(assignee);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Task[]);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save task
   */
  async saveTask(task: Task): Promise<void> {
    if (!this.db) return;
    await this.put("tasks", task);
  }

  /**
   * Save multiple tasks
   */
  async saveTasks(tasks: Task[]): Promise<void> {
    if (!this.db) return;
    const transaction = this.db.transaction(["tasks"], "readwrite");
    const store = transaction.objectStore("tasks");

    // Resolve only after the transaction fully commits, not just when individual
    // puts fire onsuccess. An IDBTransaction can still abort after per-record
    // successes (e.g. on quota exceeded), so we must wait for oncomplete.
    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      tasks.forEach((task) => {
        const request = store.put(this.serializeDates(task));
        request.onerror = () => {
          // Individual record error — the transaction will also fire onerror,
          // but surface the per-record error for better diagnostics.
          reject(request.error);
        };
      });
    });
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<void> {
    if (!this.db) return;
    await this.delete("tasks", taskId);
  }

  /**
   * Get all projects
   */
  async getAllProjects(): Promise<Project[]> {
    if (!this.db) return [];
    return this.getAll("projects") as Promise<Project[]>;
  }

  /**
   * Save project
   */
  async saveProject(project: Project): Promise<void> {
    if (!this.db) return;
    await this.put("projects", project);
  }

  /**
   * Save all columns
   */
  async saveColumns(columns: BoardColumn[]): Promise<void> {
    if (!this.db) return;
    await this.syncAll("columns", columns as unknown as Array<Record<string, unknown>>, "id");
  }

  /**
   * Get all columns
   */
  async getAllColumns(): Promise<BoardColumn[]> {
    if (!this.db) return [];
    return this.getAll("columns") as Promise<BoardColumn[]>;
  }

  /**
   * Save all priorities
   */
  async savePriorities(priorities: PriorityDefinition[]): Promise<void> {
    if (!this.db) return;
    await this.syncAll("priorities", priorities as unknown as Array<Record<string, unknown>>, "id");
  }

  /**
   * Get all priorities
   */
  async getAllPriorities(): Promise<PriorityDefinition[]> {
    if (!this.db) return [];
    return this.getAll("priorities") as Promise<PriorityDefinition[]>;
  }

  /**
   * Save all custom fields
   */
  async saveCustomFields(fields: CustomFieldDefinition[]): Promise<void> {
    if (!this.db) return;
    await this.syncAll("customFields", fields as unknown as Array<Record<string, unknown>>, "id");
  }

  /**
   * Get all custom fields
   */
  async getAllCustomFields(): Promise<CustomFieldDefinition[]> {
    if (!this.db) return [];
    return this.getAll("customFields") as Promise<CustomFieldDefinition[]>;
  }

  /**
   * Generic get all
   */
  private async getAll(storeName: string): Promise<unknown[]> {
    const db = this.db;
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        // Convert date strings back to Date objects
        const items = request.result.map((item: unknown) => this.deserializeDates(item));
        resolve(items);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Generic put
   *
   * Resolves on transaction.oncomplete (durable commit), not request.onsuccess
   * (which fires when the record is merely staged).  An IDB transaction can
   * still abort after individual request.onsuccess callbacks fire (e.g. on
   * quota exceeded), so waiting for oncomplete is required for correctness.
   */
  private async put(storeName: string, item: unknown): Promise<void> {
    const db = this.db;
    if (!db) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const serialized = this.serializeDates(item);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      store.put(serialized).onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  /**
   * Generic delete
   *
   * Resolves on transaction.oncomplete (durable commit), not request.onsuccess
   * (which fires when the delete is merely staged in the transaction buffer).
   * An IDB transaction can abort after individual request.onsuccess callbacks
   * fire, leaving the record still present on disk while the caller believes it
   * was deleted.
   */
  private async delete(storeName: string, key: string): Promise<void> {
    const db = this.db;
    if (!db) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      store.delete(key).onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  /**
   * Sync a full replacement set for a store: puts all supplied items and
   * removes any stored keys that are no longer present.  This is the safe
   * alternative to the old clear()+putAll() pattern when callers genuinely
   * need a full replacement (e.g. saveColumns / savePriorities).
   */
  private async syncAll(
    storeName: string,
    items: Array<Record<string, unknown>>,
    keyPath: string,
  ): Promise<void> {
    if (!this.db) return;
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      // First pass: collect existing keys, then put new items and delete stale ones.
      const keysRequest = store.getAllKeys();
      keysRequest.onerror = () => reject(keysRequest.error);
      keysRequest.onsuccess = () => {
        const newKeys = new Set(items.map((i) => i[keyPath] as IDBValidKey));
        const existingKeys = keysRequest.result as IDBValidKey[];

        // Delete keys that no longer exist in the new set.
        existingKeys.forEach((key) => {
          if (!newKeys.has(key)) {
            store.delete(key).onerror = (e) => reject((e.target as IDBRequest).error);
          }
        });

        // Upsert all items.
        items.forEach((item) => {
          const request = store.put(this.serializeDates(item));
          request.onerror = () => reject(request.error);
        });
      };
    });
  }

  /**
   * Serialize dates to ISO strings for storage
   */
  private serializeDates(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map((item) => this.serializeDates(item));

    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      const record = obj as Record<string, unknown>;

      for (const key in record) {
        if (Object.hasOwn(record, key)) {
          result[key] = this.serializeDates(record[key]);
        }
      }
      return result;
    }
    return obj;
  }

  /**
   * Deserialize ISO strings back to Date objects
   */
  private deserializeDates(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.deserializeDates(item));

    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      const record = obj as Record<string, unknown>;

      for (const key in record) {
        if (Object.hasOwn(record, key)) {
          const value = record[key];
          // Check if this looks like a date field
          if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            const dateFields = [
              "createdAt",
              "updatedAt",
              "dueDate",
              "completedAt",
              "timestamp",
              "nextOccurrence",
              "endDate",
            ];
            if (dateFields.includes(key)) {
              result[key] = new Date(value);
            } else {
              result[key] = this.deserializeDates(value);
            }
          } else {
            result[key] = this.deserializeDates(value);
          }
        }
      }
      return result;
    }
    return obj;
  }

  /**
   * Clear all data (for testing/reset).
   * Resolves only after the transaction fully commits.
   */
  async clearAll(): Promise<void> {
    if (!this.db) return;
    const storeNames = Array.from(this.db.objectStoreNames);
    const transaction = this.db.transaction(storeNames, "readwrite");

    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      storeNames.forEach((storeName) => {
        const request = transaction.objectStore(storeName).clear();
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Purge archived tasks older than `retentionDays` (default: 90 days).
   *
   * PRIVACY NOTE: IndexedDB stores all task data — titles, assignees, due
   * dates, custom fields — in plaintext on disk at the Chromium profile path.
   * This data is NOT removed when the Electron app is uninstalled.  Call this
   * method periodically (e.g. on app startup) to enforce a retention policy.
   *
   * For full data removal use clearAllLocalData() and instruct the user to
   * delete the Chromium profile directory manually after uninstalling.
   */
  async purgeOldArchivedTasks(retentionDays = 90): Promise<number> {
    if (!this.db) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffMs = cutoff.getTime();

    const transaction = this.db.transaction(["archivedTasks"], "readwrite");
    const store = transaction.objectStore("archivedTasks");

    return new Promise<number>((resolve, reject) => {
      let deletedCount = 0;

      transaction.oncomplete = () => resolve(deletedCount);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      const cursorRequest = store.openCursor();
      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return; // done — transaction.oncomplete fires next

        const record = cursor.value as Record<string, unknown>;
        const completedAt = record["completedAt"];
        let recordTime: number | null = null;

        if (completedAt instanceof Date) {
          recordTime = completedAt.getTime();
        } else if (typeof completedAt === "string") {
          recordTime = new Date(completedAt).getTime();
        } else if (typeof completedAt === "number") {
          recordTime = completedAt;
        }

        if (recordTime !== null && recordTime < cutoffMs) {
          const delReq = cursor.delete();
          delReq.onerror = () => reject(delReq.error);
          delReq.onsuccess = () => { deletedCount++; };
        }

        cursor.continue();
      };
    });
  }

  /**
   * Erase all locally stored data across every object store.
   *
   * IMPORTANT — UNINSTALL DATA PERSISTENCE WARNING:
   * Uninstalling the Electron app does NOT automatically delete the IndexedDB
   * files on disk.  They live inside the Chromium user-data directory, e.g.:
   *   • macOS:   ~/Library/Application Support/<AppName>/IndexedDB/
   *   • Windows: %APPDATA%\<AppName>\IndexedDB\
   *   • Linux:   ~/.config/<AppName>/IndexedDB/
   * To permanently remove all data, call this method before uninstalling, or
   * delete the Chromium profile directory manually after uninstalling.
   *
   * For encryption-at-rest of sensitive fields, evaluate Electron's
   * safeStorage API or a SQLCipher-backed storage adapter.
   */
  async clearAllLocalData(): Promise<void> {
    await this.clearAll();
  }

  /**
   * Get storage usage estimate
   */
  async getStorageEstimate(): Promise<{ usage: number; quota: number }> {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return { usage: 0, quota: 0 };
  }
}

// Singleton instance
export const indexedDBService = new IndexedDBService();
