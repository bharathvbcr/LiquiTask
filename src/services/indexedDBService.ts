import type {
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  Task,
} from "../../types";
import {
  deriveOpaqueStorageKey,
  isEncryptionActive,
  encryptPayload,
  decryptPayload,
} from "./encryptionService";

const DATE_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "dueDate",
  "completedAt",
  "timestamp",
  "nextOccurrence",
  "endDate",
]);

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
  private static readonly MIGRATION_BATCH_SIZE = 25;

  private async mapInBatches<T, R>(
    items: T[],
    mapper: (item: T) => Promise<R>,
    batchSize = IndexedDBService.MIGRATION_BATCH_SIZE,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let index = 0; index < items.length; index += batchSize) {
      const batch = items.slice(index, index + batchSize);
      const batchResults = await Promise.all(batch.map(mapper));
      results.push(...batchResults);
    }
    return results;
  }

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
    this.initPromise.catch(() => {
      this.initPromise = null;
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
    const all = await this.getAllTasks();
    return all.filter((task) => task.projectId === projectId);
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(status: string): Promise<Task[]> {
    const all = await this.getAllTasks();
    return all.filter((task) => task.status === status);
  }

  /**
   * Get tasks by assignee
   */
  async getTasksByAssignee(assignee: string): Promise<Task[]> {
    const all = await this.getAllTasks();
    return all.filter((task) => task.assignee === assignee);
  }

  /**
   * Save task
   */
  async saveTask(task: Task): Promise<void> {
    if (!this.db) return;
    await this.put("tasks", task);
  }

  /**
   * Save multiple tasks — full sync: upserts supplied tasks and removes any
   * stored records whose ids are no longer present.
   */
  async saveTasks(tasks: Task[]): Promise<void> {
    if (!this.db) return;
    await this.syncAll("tasks", tasks as unknown as Array<Record<string, unknown>>, "id");
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<void> {
    if (!this.db) return;
    await this.delete("tasks", taskId);
  }

  /**
   * Get all archived tasks
   */
  async getAllArchivedTasks(): Promise<Task[]> {
    if (!this.db) return [];
    return this.getAll("archivedTasks") as Promise<Task[]>;
  }

  /**
   * Replace the entire archived-tasks set atomically (clear + bulk put in one
   * transaction) so the store always reflects the caller's full array.
   */
  async saveArchivedTasks(tasks: Task[]): Promise<void> {
    const db = this.db;
    if (!db) return;
    const preparedTasks = await Promise.all(
      tasks.map((task) => this.prepareForStore("archivedTasks", task)),
    );

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["archivedTasks"], "readwrite");
      const store = transaction.objectStore("archivedTasks");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      const fail = () => {
        try {
          transaction.abort();
        } catch {
          // Transaction may already be aborting; rejection is handled above.
        }
      };

      store.clear().onerror = fail;
      for (const prepared of preparedTasks) {
        store.put(prepared).onerror = fail;
      }
    });
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
   * Re-encrypt all existing plaintext records (called once when enabling encryption).
   */
  async migrateToEncryptedStorage(): Promise<void> {
    if (!this.db || !isEncryptionActive()) return;
    const db = this.db;

    for (const storeConfig of OBJECT_STORES) {
      const storeName = storeConfig.name;
      const rawItems = await new Promise<unknown[]>((resolve, reject) => {
        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const toMigrate: Array<{ logicalId: string; item: unknown }> = [];
      for (const item of rawItems) {
        if (item && typeof item === "object" && "__enc" in (item as Record<string, unknown>)) {
          continue;
        }
        try {
          const parsed = await this.parseFromStore(item);
          if (!parsed || typeof parsed !== "object") continue;
          const logicalId = (parsed as Record<string, unknown>).id;
          if (typeof logicalId !== "string") continue;
          toMigrate.push({ logicalId, item: parsed });
        } catch (error) {
          console.warn(`[IndexedDB] Skipping ${storeName} record during encrypt migration:`, error);
        }
      }

      if (toMigrate.length === 0) continue;

      const preparedItems = await this.mapInBatches(toMigrate, ({ item }) =>
        this.prepareForStore(storeName, item),
      );
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

        for (const prepared of preparedItems) {
          store.put(prepared).onerror = (e) => reject((e.target as IDBRequest).error);
        }

        for (const { logicalId } of toMigrate) {
          store.delete(logicalId).onerror = (e) => reject((e.target as IDBRequest).error);
        }
      });
    }
  }

  /**
   * Decrypt all encrypted records back to plaintext (called when disabling encryption).
   */
  async migrateToDecryptedStorage(): Promise<void> {
    if (!this.db || !isEncryptionActive()) return;
    const db = this.db;

    for (const storeConfig of OBJECT_STORES) {
      const storeName = storeConfig.name;
      const rawItems = await new Promise<unknown[]>((resolve, reject) => {
        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const toRestore: Array<{ opaqueId: string; item: unknown }> = [];
      const encryptedItems = rawItems.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).__enc === "string" &&
          typeof (item as Record<string, unknown>).id === "string",
      );

      await this.mapInBatches(encryptedItems, async (record) => {
        try {
          const decrypted = await decryptPayload(record.__enc as string);
          toRestore.push({
            opaqueId: record.id as string,
            item: this.deserializeDates(decrypted),
          });
        } catch (error) {
          console.warn(`[IndexedDB] Skipping encrypted ${storeName} record during decrypt migration:`, error);
        }
      });

      if (toRestore.length === 0) continue;

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

        for (const { opaqueId, item } of toRestore) {
          const serialized = this.serializeDates(item);
          store.put(serialized).onerror = (e) => reject((e.target as IDBRequest).error);
          store.delete(opaqueId).onerror = (e) => reject((e.target as IDBRequest).error);
        }
      });
    }
  }

  /**
   * Generic get all
   */
  private async getAll(storeName: string): Promise<unknown[]> {
    const db = this.db;
    if (!db) return [];
    const rawItems = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const items: unknown[] = [];
    for (const item of rawItems) {
      const parsed = await this.parseFromStore(item);
      if (parsed != null) {
        items.push(parsed);
      }
    }
    return items;
  }

  /**
   * Generic put
   *
   * Resolves on transaction.oncomplete (durable commit), not request.onsuccess
   * (which fires when the record is merely staged).  An IDB transaction can
   * still abort after individual request.onsuccess callbacks fire (e.g. on
   * quota exceeded), so waiting for oncomplete is required for correctness.
   */
  private async resolveStorageKey(storeName: string, logicalKey: string): Promise<string> {
    if (!isEncryptionActive()) return logicalKey;
    return deriveOpaqueStorageKey(storeName, logicalKey);
  }

  private async put(storeName: string, item: unknown): Promise<void> {
    const db = this.db;
    if (!db) return;
    const prepared = await this.prepareForStore(storeName, item);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      store.put(prepared).onerror = (e) => reject((e.target as IDBRequest).error);
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
  private async delete(storeName: string, logicalKey: string): Promise<void> {
    const db = this.db;
    if (!db) return;
    const storageKey = await this.resolveStorageKey(storeName, logicalKey);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      store.delete(storageKey).onerror = (e) => reject((e.target as IDBRequest).error);
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
    _keyPath: string,
  ): Promise<void> {
    if (!this.db) return;
    const preparedItems = await Promise.all(
      items.map((item) => this.prepareForStore(storeName, item)),
    );
    const newKeys = new Set(
      preparedItems.map((item) => (item as Record<string, unknown>).id as IDBValidKey),
    );
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));

      const keysRequest = store.getAllKeys();
      keysRequest.onerror = () => reject(keysRequest.error);
      keysRequest.onsuccess = () => {
        const existingKeys = keysRequest.result as IDBValidKey[];

        existingKeys.forEach((key) => {
          if (!newKeys.has(key)) {
            store.delete(key).onerror = (e) => reject((e.target as IDBRequest).error);
          }
        });

        preparedItems.forEach((prepared) => {
          const request = store.put(prepared);
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

  private async prepareForStore(storeName: string, item: unknown): Promise<unknown> {
    const serialized = this.serializeDates(item);
    if (!isEncryptionActive() || !serialized || typeof serialized !== "object") {
      return serialized;
    }

    const record = serialized as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string") {
      return serialized;
    }

    const opaqueId = await deriveOpaqueStorageKey(storeName, id);
    return {
      id: opaqueId,
      __enc: await encryptPayload(record),
    };
  }

  private async parseFromStore(item: unknown): Promise<unknown> {
    if (!item || typeof item !== "object") {
      return item;
    }

    const record = item as Record<string, unknown>;
    if (typeof record.__enc === "string") {
      if (!isEncryptionActive()) {
        console.warn("[IndexedDB] Encrypted record present while encryption is locked");
        return null;
      }
      try {
        const decrypted = await decryptPayload(record.__enc);
        return this.deserializeDates(decrypted);
      } catch (error) {
        console.warn("[IndexedDB] Failed to decrypt stored record:", error);
        return null;
      }
    }

    return this.deserializeDates(item);
  }

  /**
   * Deserialize ISO strings back to Date objects
   */
  private deserializeDates(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.deserializeDates(item));
    if (typeof obj !== "object") return obj;

    const result: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      const value = record[key];
      if (key === "customFieldValues") {
        result[key] = value;
      } else if (DATE_FIELDS.has(key) && typeof value === "string" && value.length > 0) {
        const d = new Date(value);
        result[key] = Number.isNaN(d.getTime()) ? value : d;
      } else {
        result[key] = this.deserializeDates(value);
      }
    }
    return result;
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
   * With encryption enabled, records are AES-256-GCM blobs addressed by opaque
   * HMAC-derived keys — no task metadata is readable on disk.
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

    const archived = await this.getAllArchivedTasks();
    const stale = archived.filter((task) => {
      const candidate = task.completedAt ?? task.updatedAt ?? task.createdAt;
      if (!candidate) return false;
      return new Date(candidate).getTime() < cutoffMs;
    });

    for (const task of stale) {
      await this.delete("archivedTasks", task.id);
    }

    return stale.length;
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
