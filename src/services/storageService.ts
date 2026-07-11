import type {
  ActivityItem,
  BoardColumn,
  CustomFieldDefinition,
  MigratableAppData,
  PriorityDefinition,
  Project,
  ProjectType,
  RecurringConfig,
  Task,
} from "../../types";
import {
  DEFAULT_COLUMNS,
  DEFAULT_PRIORITIES,
  DEFAULT_PROJECT_TYPES,
  DEFAULT_PROJECTS,
  STORAGE_KEYS,
} from "../constants";
import { getNativeStorageApi, isTauri } from "../runtime/runtimeEnvironment";
import { trySaveToStorage } from "../utils/storageQuota";
import { validateAndTransformImportedData } from "../utils/validation";
import { isNativeBackend, nativeParseTasks, nativeSerializeTasks } from "./nativeBridge";
import {
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  isEncryptionActive,
} from "./encryptionService";
import { indexedDBService } from "./indexedDBService";
import { CURRENT_DATA_VERSION, migrationService } from "./migrationService";
import {
  isSqliteTaskStoreActive,
  readSqliteSnapshot,
  seedSqliteSnapshot,
  writeSqliteSnapshot,
} from "./sqliteTaskStore";

// Type for all storable data
export interface AppData {
  columns: BoardColumn[];
  projectTypes: ProjectType[];
  priorities: PriorityDefinition[];
  customFields: CustomFieldDefinition[];
  projects: Project[];
  tasks: Task[];
  activeProjectId: string;
  sidebarCollapsed: boolean;
  grouping: "none" | "priority";
  version?: string; // Data schema version for migration
}

// Re-export current data version from migration service
export { CURRENT_DATA_VERSION };

// Parse tasks with proper date handling (web fallback; desktop uses Rust via nativeParseTasks).
function parseTasks(data: Record<string, unknown>[]): Task[] {
  return data.map((t) => {
    const errorLogs = Array.isArray(t.errorLogs)
      ? (t.errorLogs as Record<string, unknown>[]).map((log) => ({
          timestamp: new Date(log.timestamp as string | number | Date),
          message: (log.message as string) || "",
        }))
      : undefined;

    return {
      id: t.id as string,
      jobId: t.jobId as string,
      projectId: t.projectId as string,
      title: (t.title as string) || "",
      subtitle: (t.subtitle as string | undefined) || undefined,
      summary: (t.summary as string) || "",
      assignee: (t.assignee as string) || "",
      priority: (t.priority as string) || "medium",
      status: t.status as string,
      createdAt: new Date(t.createdAt as string | number | Date),
      updatedAt: t.updatedAt ? new Date(t.updatedAt as string | number | Date) : undefined,
      dueDate: t.dueDate ? new Date(t.dueDate as string | number | Date) : undefined,
      completedAt: t.completedAt ? new Date(t.completedAt as string | number | Date) : undefined,
      subtasks: (t.subtasks as Task["subtasks"]) || [],
      attachments: (t.attachments as Task["attachments"]) || [],
      customFieldValues: (t.customFieldValues as Task["customFieldValues"]) || {},
      links: (t.links as Task["links"]) || [],
      tags: (t.tags as string[]) || [],
      timeEstimate: (t.timeEstimate as number) || 0,
      timeSpent: (t.timeSpent as number) || 0,
      errorLogs: errorLogs,
      recurring: t.recurring
        ? {
            ...(t.recurring as RecurringConfig),
            endDate: (t.recurring as Record<string, unknown>).endDate
              ? new Date((t.recurring as Record<string, unknown>).endDate as string)
              : undefined,
            nextOccurrence: (t.recurring as Record<string, unknown>).nextOccurrence
              ? new Date((t.recurring as Record<string, unknown>).nextOccurrence as string)
              : undefined,
          }
        : undefined,
      activity: Array.isArray(t.activity)
        ? (t.activity as Record<string, unknown>[]).map((item) => ({
            ...(item as unknown as ActivityItem),
            timestamp: new Date(item.timestamp as string | number | Date),
          }))
        : undefined,
      githubIssue: t.githubIssue as Task["githubIssue"],
    };
  });
}

async function parseTasksFromStorage(data: Record<string, unknown>[]): Promise<Task[]> {
  if (isNativeBackend()) {
    try {
      return await nativeParseTasks(data);
    } catch (err) {
      console.warn("[storage] native task parse failed; falling back to JS:", err);
    }
  }
  return parseTasks(data);
}

// Storage service with localStorage fallback
class StorageService {
  private cache: Map<string, unknown> = new Map();

  get<T>(key: string, defaultValue: T): T {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }

    // Sensitive keys must never be read from plaintext localStorage.
    // The authoritative value lives in native storage and is populated into
    // the cache during initialize(). If the cache has no entry yet, return
    // the default rather than exposing a plaintext credential.
    if (StorageService.SENSITIVE_KEYS.has(key)) {
      return defaultValue;
    }

    try {
      if (isEncryptionActive() && isTauri()) {
        return defaultValue;
      }

      const stored = localStorage.getItem(key);
      if (stored) {
        if (isEncryptedEnvelope(stored)) {
          console.warn(`Encrypted value for ${key} is unavailable in synchronous storage read`);
          return defaultValue;
        }

        const parsed = JSON.parse(stored);
        // Special handling for tasks
        if (key === STORAGE_KEYS.TASKS) {
          const tasks = parseTasks(parsed);
          this.cache.set(key, tasks);
          return tasks as T;
        }
        this.cache.set(key, parsed);
        return parsed as T;
      }
    } catch (e) {
      console.warn(`Failed to parse stored value for ${key}:`, e);
    }

    return defaultValue;
  }

  /** Load plaintext browser localStorage entries into the in-memory cache. */
  hydratePlaintextLocalStorage(): void {
    if (isTauri()) return;

    for (const key of Object.values(STORAGE_KEYS)) {
      if (StorageService.SENSITIVE_KEYS.has(key)) continue;

      const stored = localStorage.getItem(key);
      if (!stored || isEncryptedEnvelope(stored)) continue;

      try {
        const parsed = JSON.parse(stored);
        if (key === STORAGE_KEYS.TASKS) {
          this.cache.set(key, parseTasks(parsed));
        } else {
          this.cache.set(key, parsed);
        }
      } catch (e) {
        console.warn(`Failed to hydrate plaintext storage for ${key}:`, e);
      }
    }
  }

  /** Decrypt browser localStorage envelopes back to plaintext (before disabling encryption). */
  async decryptLocalStorageToPlaintext(): Promise<void> {
    if (!isEncryptionActive() || isTauri()) return;

    for (const key of Object.values(STORAGE_KEYS)) {
      if (StorageService.SENSITIVE_KEYS.has(key)) continue;

      const stored = localStorage.getItem(key);
      if (!stored || !isEncryptedEnvelope(stored)) continue;

      try {
        const decrypted = await decryptPayload(stored);
        const value =
          key === STORAGE_KEYS.TASKS
            ? parseTasks(decrypted as Record<string, unknown>[])
            : decrypted;
        this.cache.set(key, value);
        const serialized = JSON.stringify(value);
        const result = trySaveToStorage(key, serialized);
        if (!result.success) {
          throw new Error(result.error);
        }
      } catch (e) {
        console.warn(`Failed to decrypt storage for ${key}:`, e);
        throw e;
      }
    }
  }

  /** Load encrypted browser localStorage entries into the in-memory cache after unlock. */
  async hydrateEncryptedLocalStorage(): Promise<void> {
    if (!isEncryptionActive() || isTauri()) return;

    for (const key of Object.values(STORAGE_KEYS)) {
      if (StorageService.SENSITIVE_KEYS.has(key)) continue;

      const stored = localStorage.getItem(key);
      if (!stored) continue;

      try {
        if (isEncryptedEnvelope(stored)) {
          const decrypted = await decryptPayload(stored);
          if (key === STORAGE_KEYS.TASKS) {
            this.cache.set(key, parseTasks(decrypted as Record<string, unknown>[]));
          } else {
            this.cache.set(key, decrypted);
          }
          continue;
        }

        const parsed = JSON.parse(stored);
        if (key === STORAGE_KEYS.TASKS) {
          this.cache.set(key, parseTasks(parsed));
        } else {
          this.cache.set(key, parsed);
        }
        await this.set(key, this.cache.get(key));
      } catch (e) {
        console.warn(`Failed to hydrate encrypted storage for ${key}:`, e);
      }
    }
  }

  async initialize(): Promise<void> {
    const nativeStorage = getNativeStorageApi();
    if (!nativeStorage) {
      if (isEncryptionActive()) {
        await this.hydrateEncryptedLocalStorage();
      } else {
        this.hydratePlaintextLocalStorage();
      }
      return;
    }

    try {
      await this.loadFromNativeStorage(nativeStorage);
    } catch (error) {
      console.error("Failed to initialize storage service:", error);
    }
  }

  /** Reload from disk after encryption state changes (e.g. disable on desktop). */
  async reinitialize(): Promise<void> {
    this.cache.clear();
    const nativeStorage = getNativeStorageApi();
    if (!nativeStorage) {
      if (isEncryptionActive()) {
        await this.hydrateEncryptedLocalStorage();
      } else {
        this.hydratePlaintextLocalStorage();
      }
      return;
    }

    try {
      await this.loadFromNativeStorage(nativeStorage);
    } catch (error) {
      console.error("Failed to reinitialize storage service:", error);
    }
  }

  private async loadFromNativeStorage(
    nativeStorage: NonNullable<ReturnType<typeof getNativeStorageApi>>,
  ): Promise<void> {
    // One-time cleanup: unconditionally purge sensitive keys from plaintext
    // localStorage, regardless of whether native storage has a copy. This
    // removes any credentials written by app versions prior to the
    // SENSITIVE_KEYS guard being introduced.
    for (const key of StorageService.SENSITIVE_KEYS) {
      localStorage.removeItem(key);
    }

    // Load all keys from native storage
    const keys = Object.values(STORAGE_KEYS);
    for (const key of keys) {
      const value = await nativeStorage.get(key);

      if (value != null) {
        if (key === STORAGE_KEYS.TASKS) {
          this.cache.set(key, await parseTasksFromStorage(value as Record<string, unknown>[]));
        } else {
          this.cache.set(key, value);
        }
      } else {
        // Fallback to localStorage (Migration) — skip sensitive keys because
        // the unconditional purge above has already removed them, and we must
        // not read plaintext credentials from localStorage even during migration.
        if (StorageService.SENSITIVE_KEYS.has(key)) {
          continue;
        }
        const local = localStorage.getItem(key);
        if (local) {
          try {
            const parsed = JSON.parse(local);
            if (key === STORAGE_KEYS.TASKS) {
              this.cache.set(key, parseTasks(parsed));
            } else {
              this.cache.set(key, parsed);
            }
            // Save to native storage for next time
            await nativeStorage.set(key, parsed);
            // Migration complete for key
          } catch (e) {
            console.error(`Failed to migrate ${key}`, e);
          }
        }
      }
    }

    // Phase 5 cutover: seed SQLite on first boot, then make it the source of
    // truth for tasks/projects/columns (the key-value store loaded above stays
    // as the read-only fallback). Runs before migrations so schema migrations
    // operate on — and persist back through — the SQLite-sourced data.
    await this.hydrateFromSqlite();

    // Run data schema migrations after loading all data
    await this.runDataMigrations();
  }

  /**
   * One-time IndexedDB/key-value → SQLite import plus the flagged read path.
   *
   * On the first boot with `TASKS_SQLITE_ENABLED`, the tasks/projects/columns
   * already loaded from the key-value store (or IndexedDB) are seeded into
   * SQLite. Thereafter the SQLite snapshot is authoritative and overrides the
   * in-memory cache. If SQLite is unavailable/empty we silently keep the
   * key-value values, so a read failure degrades to the previous behaviour.
   */
  private async hydrateFromSqlite(): Promise<void> {
    if (!isSqliteTaskStoreActive()) return;

    try {
      let snapshot = await readSqliteSnapshot();
      const alreadyImported = this.get<boolean>(STORAGE_KEYS.TASKS_SQLITE_IMPORTED, false);
      const isEmpty = (s: typeof snapshot): boolean =>
        !s || (s.tasks.length === 0 && s.projects.length === 0 && s.columns.length === 0);

      if (!alreadyImported && isEmpty(snapshot)) {
        const seed = await this.collectSqliteImportSeed();
        if (seed.tasks.length > 0 || seed.projects.length > 0 || seed.columns.length > 0) {
          await seedSqliteSnapshot(seed);
          snapshot = await readSqliteSnapshot();
          console.info(
            `[Storage] Imported ${seed.tasks.length} task(s), ${seed.projects.length} project(s), ` +
              `${seed.columns.length} column(s) into SQLite (one-time cutover).`,
          );
        }
        await this.set(STORAGE_KEYS.TASKS_SQLITE_IMPORTED, true);
      }

      if (!isEmpty(snapshot) && snapshot) {
        this.compareSqliteParity(snapshot);
        // SQLite is authoritative now — override the key-value-sourced cache.
        this.cache.set(STORAGE_KEYS.TASKS, snapshot.tasks);
        this.cache.set(STORAGE_KEYS.PROJECTS, snapshot.projects);
        this.cache.set(STORAGE_KEYS.COLUMNS, snapshot.columns);
      }
    } catch (error) {
      console.warn("[Storage] SQLite hydration failed; using key-value fallback:", error);
    }
  }

  /**
   * Assemble the one-time import seed, preferring the key-value cache (already
   * loaded) and falling back to the IndexedDB mirror when the cache is empty
   * (e.g. an install that only ever wrote to IndexedDB).
   */
  private async collectSqliteImportSeed(): Promise<{
    tasks: Task[];
    projects: Project[];
    columns: BoardColumn[];
  }> {
    let tasks = (this.cache.get(STORAGE_KEYS.TASKS) as Task[] | undefined) ?? [];
    let projects = (this.cache.get(STORAGE_KEYS.PROJECTS) as Project[] | undefined) ?? [];
    let columns = (this.cache.get(STORAGE_KEYS.COLUMNS) as BoardColumn[] | undefined) ?? [];

    if (
      indexedDBService.isAvailable() &&
      tasks.length === 0 &&
      projects.length === 0 &&
      columns.length === 0
    ) {
      try {
        [tasks, projects, columns] = await Promise.all([
          indexedDBService.getAllTasks(),
          indexedDBService.getAllProjects(),
          indexedDBService.getAllColumns(),
        ]);
      } catch (error) {
        console.warn("[Storage] IndexedDB seed read failed during SQLite import:", error);
      }
    }

    return { tasks, projects, columns };
  }

  /**
   * Dev-only parity check: warn when the SQLite snapshot diverges in size from
   * the key-value/IndexedDB fallback still held in the cache. Proves the
   * dual-write stays converged before IndexedDB is fully retired.
   */
  private compareSqliteParity(snapshot: {
    tasks: Task[];
    projects: Project[];
    columns: BoardColumn[];
  }): void {
    if (process.env.NODE_ENV === "production") return;
    const cacheTasks = (this.cache.get(STORAGE_KEYS.TASKS) as Task[] | undefined) ?? [];
    const cacheProjects = (this.cache.get(STORAGE_KEYS.PROJECTS) as Project[] | undefined) ?? [];
    const cacheColumns = (this.cache.get(STORAGE_KEYS.COLUMNS) as BoardColumn[] | undefined) ?? [];
    const mismatches: string[] = [];
    if (cacheTasks.length && snapshot.tasks.length !== cacheTasks.length)
      mismatches.push(`tasks ${snapshot.tasks.length} vs ${cacheTasks.length}`);
    if (cacheProjects.length && snapshot.projects.length !== cacheProjects.length)
      mismatches.push(`projects ${snapshot.projects.length} vs ${cacheProjects.length}`);
    if (cacheColumns.length && snapshot.columns.length !== cacheColumns.length)
      mismatches.push(`columns ${snapshot.columns.length} vs ${cacheColumns.length}`);
    if (mismatches.length > 0) {
      console.warn(`[Storage] SQLite parity mismatch (sqlite vs fallback): ${mismatches.join("; ")}`);
    }
  }

  /**
   * Run data schema migrations if needed
   */
  private async runDataMigrations(): Promise<void> {
    const currentData = this.getAllData() as MigratableAppData;
    // getAllData() does not surface the persisted schema version, so read it
    // directly — otherwise storedVersion is always "0.0.0" and migrations are
    // re-evaluated on every launch.
    const storedVersion = this.get<string>(STORAGE_KEYS.DATA_VERSION, "0.0.0");

    // Check if migration is needed
    if (!migrationService.needsMigration(storedVersion)) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[Storage] Data migration needed: ${storedVersion} → ${CURRENT_DATA_VERSION}`);

    // Run migrations
    const result = migrationService.runMigrations(currentData, storedVersion);

    if (result.success && result.data) {
      // Save migrated data
      await this.saveAllData(result.data);
      // eslint-disable-next-line no-console
      console.log(`[Storage] Migration complete: ${result.migratedFrom} → ${result.migratedTo}`);
    } else {
      console.error(`[Storage] Migration failed: ${result.error}`);
      // Data is preserved from backup - user can recover if needed
    }
  }

  /**
   * Save all app data to storage
   */
  private async saveAllData(data: MigratableAppData): Promise<void> {
    // Collect all async write promises so we can await them before returning.
    // This ensures IndexedDB and native storage reflect migrated data before the
    // caller proceeds (prevents stale-read races after runDataMigrations).
    const writes: Promise<void>[] = [];
    if (data.columns) writes.push(this.set(STORAGE_KEYS.COLUMNS, data.columns));
    if (data.projectTypes) writes.push(this.set(STORAGE_KEYS.PROJECT_TYPES, data.projectTypes));
    if (data.priorities) writes.push(this.set(STORAGE_KEYS.PRIORITIES, data.priorities));
    if (data.customFields) writes.push(this.set(STORAGE_KEYS.CUSTOM_FIELDS, data.customFields));
    if (data.projects) writes.push(this.set(STORAGE_KEYS.PROJECTS, data.projects));
    if (data.tasks) writes.push(this.set(STORAGE_KEYS.TASKS, data.tasks));
    if (data.activeProjectId !== undefined)
      writes.push(this.set(STORAGE_KEYS.ACTIVE_PROJECT, data.activeProjectId));
    if (data.sidebarCollapsed !== undefined)
      writes.push(this.set(STORAGE_KEYS.SIDEBAR_COLLAPSED, data.sidebarCollapsed));
    if (data.grouping) writes.push(this.set(STORAGE_KEYS.GROUPING, data.grouping));
    if (data.version) writes.push(this.set(STORAGE_KEYS.DATA_VERSION, data.version));
    await Promise.all(writes);
  }

  /**
   * Keys that contain credentials or secrets and must never be written to
   * the plaintext localStorage fallback.
   */
  private static readonly SENSITIVE_KEYS: Set<string> = new Set([
    STORAGE_KEYS.AI_CONFIG,
    STORAGE_KEYS.GEMINI_API_KEY,
    STORAGE_KEYS.SEARCH_HISTORY,
    STORAGE_KEYS.COMMAND_HISTORY,
    STORAGE_KEYS.AI_SEMANTIC_CACHE,
    STORAGE_KEYS.AUTO_ORGANIZE_HISTORY,
    STORAGE_KEYS.AI_ORGANIZE_CACHE,
    STORAGE_KEYS.BACKUPS,
    STORAGE_KEYS.REMOTE_PUSH_CONFIG,
  ]);

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);

    const asyncWrites: Promise<unknown>[] = [];

    // Save to IndexedDB if available (for large data like tasks)
    if (
      indexedDBService.isAvailable() &&
      (key === STORAGE_KEYS.TASKS ||
        key === STORAGE_KEYS.PROJECTS ||
        key === STORAGE_KEYS.COLUMNS ||
        key === STORAGE_KEYS.PRIORITIES ||
        key === STORAGE_KEYS.CUSTOM_FIELDS)
    ) {
      if (key === STORAGE_KEYS.TASKS) {
        asyncWrites.push(indexedDBService.saveTasks(value as Task[]));
      } else if (key === STORAGE_KEYS.PROJECTS) {
        const projects = value as Project[];
        asyncWrites.push(Promise.all(projects.map((p) => indexedDBService.saveProject(p))));
      } else if (key === STORAGE_KEYS.COLUMNS) {
        asyncWrites.push(indexedDBService.saveColumns(value as BoardColumn[]));
      } else if (key === STORAGE_KEYS.PRIORITIES) {
        asyncWrites.push(indexedDBService.savePriorities(value as PriorityDefinition[]));
      } else if (key === STORAGE_KEYS.CUSTOM_FIELDS) {
        asyncWrites.push(indexedDBService.saveCustomFields(value as CustomFieldDefinition[]));
      }
    }

    // SQLite dual-write (Phase 5 cutover): mirror the affected entity to the
    // Rust task store. Only the changed list is sent so a task edit never
    // clobbers projects/columns (full replacement is per-table). No-op unless
    // SQLite is the active store (desktop + flag on).
    if (isSqliteTaskStoreActive()) {
      if (key === STORAGE_KEYS.TASKS) {
        asyncWrites.push(writeSqliteSnapshot({ tasks: value as Task[] }));
      } else if (key === STORAGE_KEYS.PROJECTS) {
        asyncWrites.push(writeSqliteSnapshot({ projects: value as Project[] }));
      } else if (key === STORAGE_KEYS.COLUMNS) {
        asyncWrites.push(writeSqliteSnapshot({ columns: value as BoardColumn[] }));
      }
    }

    const nativeStorage = getNativeStorageApi();
    if (nativeStorage) {
      // Native Save (backup). Sensitive keys are encrypted at rest by the Tauri
      // storage backend (keychain-backed AES-GCM envelopes).
      if (key === STORAGE_KEYS.TASKS && isNativeBackend()) {
        asyncWrites.push(
          (async () => {
            const serialized = await nativeSerializeTasks(value as Task[]);
            await nativeStorage.set(key, serialized);
          })(),
        );
      } else {
        asyncWrites.push(nativeStorage.set(key, value));
      }
    }

    // Save to localStorage as backup/fallback for non-sensitive keys only.
    // When encryption at rest is enabled, avoid plaintext localStorage copies.
    if (!StorageService.SENSITIVE_KEYS.has(key)) {
      try {
        if (isEncryptionActive() && !isTauri()) {
          const envelope = await encryptPayload(value);
          const result = trySaveToStorage(key, envelope);
          if (!result.success) throw new Error(result.error);
        } else if (!isEncryptionActive()) {
          const serialized = JSON.stringify(value);
          const result = trySaveToStorage(key, serialized);
          if (!result.success) throw new Error(result.error);
        }
      } catch (e) {
        console.error(`Failed to save ${key} to localStorage:`, e);
      }
    }

    // Use allSettled so one backend failing (e.g. IndexedDB quota) does not hide
    // failures in the others. Surface a consolidated, key-scoped error when any
    // backend write rejects so partial divergence is observable rather than silent.
    const results = await Promise.allSettled(asyncWrites);
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failures.length > 0) {
      const reasons = failures.map((f) => f.reason);
      console.error(
        `Failed to persist "${key}" to ${failures.length} of ${asyncWrites.length} async backend(s):`,
        ...reasons,
      );
      throw new Error(
        `Failed to persist "${key}": ${reasons.map((r) => (r instanceof Error ? r.message : String(r))).join("; ")}`,
      );
    }
  }

  remove(key: string): void {
    this.cache.delete(key);
    const nativeStorage = getNativeStorageApi();
    if (nativeStorage) {
      nativeStorage.delete(key).catch(console.error);
    }
    localStorage.removeItem(key);
  }

  clear(): void {
    this.cache.clear();
    const nativeStorage = getNativeStorageApi();
    if (nativeStorage) {
      nativeStorage.clear().catch(console.error);
    }
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
    localStorage.clear();
    if (indexedDBService.isAvailable()) {
      indexedDBService.clearAllLocalData().catch(console.error);
    }
  }

  // Get all app data
  getAllData(): Partial<AppData> {
    return {
      columns: this.get(STORAGE_KEYS.COLUMNS, [...DEFAULT_COLUMNS] as BoardColumn[]),
      projectTypes: this.get(STORAGE_KEYS.PROJECT_TYPES, [
        ...DEFAULT_PROJECT_TYPES,
      ] as ProjectType[]),
      priorities: this.get(STORAGE_KEYS.PRIORITIES, [
        ...DEFAULT_PRIORITIES,
      ] as PriorityDefinition[]),
      customFields: this.get(STORAGE_KEYS.CUSTOM_FIELDS, [] as CustomFieldDefinition[]),
      projects: this.get(STORAGE_KEYS.PROJECTS, [...DEFAULT_PROJECTS] as Project[]),
      tasks: this.get(STORAGE_KEYS.TASKS, [] as Task[]),
      activeProjectId: this.get(STORAGE_KEYS.ACTIVE_PROJECT, ""),
      sidebarCollapsed: this.get(STORAGE_KEYS.SIDEBAR_COLLAPSED, false),
      grouping: this.get(STORAGE_KEYS.GROUPING, "none"),
    };
  }

  // Export all data for backup
  exportData(): string {
    const data = this.getAllData();
    const dataWithVersion = {
      ...data,
      version: CURRENT_DATA_VERSION,
    };
    return JSON.stringify(dataWithVersion, null, 2);
  }

  // Import data with validation and migration
  importData(jsonString: string): {
    data: Partial<AppData> | null;
    error?: string;
  } {
    try {
      let parsed = JSON.parse(jsonString);

      // Check version and migrate if needed
      const importedVersion = parsed.version || "0.0.0";
      if (importedVersion !== CURRENT_DATA_VERSION && migrationService.needsMigration(importedVersion)) {
        const migResult = migrationService.runMigrations(parsed as MigratableAppData, importedVersion);
        if (!migResult.success) {
          return { data: null, error: migResult.error ?? "Migration failed" };
        }
        parsed = migResult.data;
      }

      // Validate with Zod schema
      const validated = validateAndTransformImportedData(parsed);

      if (!validated) {
        return { data: null, error: "Validation failed" };
      }

      // Convert ValidatedAppData to Partial<AppData> format
      const appData: Partial<AppData> = {
        columns: validated.columns,
        projectTypes: validated.projectTypes,
        priorities: validated.priorities,
        customFields: validated.customFields,
        projects: validated.projects,
        tasks: validated.tasks,
        activeProjectId: validated.activeProjectId,
        sidebarCollapsed: validated.sidebarCollapsed,
        grouping: validated.grouping,
        version: CURRENT_DATA_VERSION,
      };

      return { data: appData };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      console.error("Failed to import data:", e);
      return { data: null, error: errorMessage };
    }
  }
}

// Singleton instance
export const storageService = new StorageService();
export default storageService;
