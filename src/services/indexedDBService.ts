import { Task, Project, BoardColumn, PriorityDefinition, CustomFieldDefinition } from '../../types';

const DB_NAME = 'LiquiTaskDB';
const DB_VERSION = 1;

interface ObjectStore {
    name: string;
    keyPath: string;
    indexes: Array<{ name: string; keyPath: string; unique?: boolean }>;
}

const OBJECT_STORES: ObjectStore[] = [
    {
        name: 'tasks',
        keyPath: 'id',
        indexes: [
            { name: 'projectId', keyPath: 'projectId', unique: false },
            { name: 'status', keyPath: 'status', unique: false },
            { name: 'assignee', keyPath: 'assignee', unique: false },
            { name: 'priority', keyPath: 'priority', unique: false },
            { name: 'dueDate', keyPath: 'dueDate', unique: false },
            { name: 'createdAt', keyPath: 'createdAt', unique: false },
        ],
    },
    {
        name: 'projects',
        keyPath: 'id',
        indexes: [{ name: 'parentId', keyPath: 'parentId', unique: false }],
    },
    {
        name: 'columns',
        keyPath: 'id',
        indexes: [],
    },
    {
        name: 'priorities',
        keyPath: 'id',
        indexes: [],
    },
    {
        name: 'customFields',
        keyPath: 'id',
        indexes: [],
    },
    {
        name: 'projectTypes',
        keyPath: 'id',
        indexes: [],
    },
    {
        name: 'archivedTasks',
        keyPath: 'id',
        indexes: [
            { name: 'projectId', keyPath: 'projectId', unique: false },
            { name: 'completedAt', keyPath: 'completedAt', unique: false },
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
            if (typeof indexedDB === 'undefined') {
                console.warn('IndexedDB not supported, falling back to localStorage');
                resolve();
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create object stores
                OBJECT_STORES.forEach(storeConfig => {
                    if (!db.objectStoreNames.contains(storeConfig.name)) {
                        const store = db.createObjectStore(storeConfig.name, {
                            keyPath: storeConfig.keyPath,
                        });

                        // Create indexes
                        storeConfig.indexes.forEach(indexConfig => {
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
        return typeof indexedDB !== 'undefined' && this.db !== null;
    }

    /**
     * Get all tasks
     */
    async getAllTasks(): Promise<Task[]> {
        if (!this.db) return [];
        return this.getAll('tasks') as Promise<Task[]>;
    }

    /**
     * Get tasks by project
     */
    async getTasksByProject(projectId: string): Promise<Task[]> {
        if (!this.db) return [];
        const transaction = this.db.transaction(['tasks'], 'readonly');
        const store = transaction.objectStore('tasks');
        const index = store.index('projectId');
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
        const transaction = this.db.transaction(['tasks'], 'readonly');
        const store = transaction.objectStore('tasks');
        const index = store.index('status');
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
        const transaction = this.db.transaction(['tasks'], 'readonly');
        const store = transaction.objectStore('tasks');
        const index = store.index('assignee');
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
        await this.put('tasks', task);
    }

    /**
     * Save multiple tasks
     */
    async saveTasks(tasks: Task[]): Promise<void> {
        if (!this.db) return;
        const transaction = this.db.transaction(['tasks'], 'readwrite');
        const store = transaction.objectStore('tasks');

        await Promise.all(tasks.map(task => {
            return new Promise<void>((resolve, reject) => {
                const request = store.put(task);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }));
    }

    /**
     * Delete task
     */
    async deleteTask(taskId: string): Promise<void> {
        if (!this.db) return;
        await this.delete('tasks', taskId);
    }

    /**
     * Get all projects
     */
    async getAllProjects(): Promise<Project[]> {
        if (!this.db) return [];
        return this.getAll('projects') as Promise<Project[]>;
    }

    /**
     * Save project
     */
    async saveProject(project: Project): Promise<void> {
        if (!this.db) return;
        await this.put('projects', project);
    }

    /**
     * Save all columns
     */
    async saveColumns(columns: BoardColumn[]): Promise<void> {
        if (!this.db) return;
        await this.saveAll('columns', columns);
    }

    /**
     * Get all columns
     */
    async getAllColumns(): Promise<BoardColumn[]> {
        if (!this.db) return [];
        return this.getAll('columns') as Promise<BoardColumn[]>;
    }

    /**
     * Save all priorities
     */
    async savePriorities(priorities: PriorityDefinition[]): Promise<void> {
        if (!this.db) return;
        await this.saveAll('priorities', priorities);
    }

    /**
     * Get all priorities
     */
    async getAllPriorities(): Promise<PriorityDefinition[]> {
        if (!this.db) return [];
        return this.getAll('priorities') as Promise<PriorityDefinition[]>;
    }

    /**
     * Save all custom fields
     */
    async saveCustomFields(fields: CustomFieldDefinition[]): Promise<void> {
        if (!this.db) return;
        await this.saveAll('customFields', fields);
    }

    /**
     * Get all custom fields
     */
    async getAllCustomFields(): Promise<CustomFieldDefinition[]> {
        if (!this.db) return [];
        return this.getAll('customFields') as Promise<CustomFieldDefinition[]>;
    }

    /**
     * Generic get all
     */
    private async getAll(storeName: string): Promise<unknown[]> {
        if (!this.db) return [];
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([storeName], 'readonly');
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
     */
    private async put(storeName: string, item: unknown): Promise<void> {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const serialized = this.serializeDates(item);
            const request = store.put(serialized);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Generic delete
     */
    private async delete(storeName: string, key: string): Promise<void> {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save all items in a store
     */
    private async saveAll(storeName: string, items: unknown[]): Promise<void> {
        if (!this.db) return;
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        // Clear existing
        await new Promise<void>((resolve, reject) => {
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => resolve();
            clearRequest.onerror = () => reject(clearRequest.error);
        });

        // Add all items
        await Promise.all(items.map(item => {
            return new Promise<void>((resolve, reject) => {
                const serialized = this.serializeDates(item);
                const request = store.put(serialized);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }));
    }

    /**
     * Serialize dates to ISO strings for storage
     */
    private serializeDates(obj: unknown): unknown {
        if (obj === null || obj === undefined) return obj;
        if (obj instanceof Date) return obj.toISOString();
        if (Array.isArray(obj)) return obj.map(item => this.serializeDates(item));

        if (typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            const record = obj as Record<string, unknown>;

            for (const key in record) {
                if (Object.prototype.hasOwnProperty.call(record, key)) {
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
        if (Array.isArray(obj)) return obj.map(item => this.deserializeDates(item));

        if (typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            const record = obj as Record<string, unknown>;

            for (const key in record) {
                if (Object.prototype.hasOwnProperty.call(record, key)) {
                    const value = record[key];
                    // Check if this looks like a date field
                    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                        const dateFields = ['createdAt', 'updatedAt', 'dueDate', 'completedAt', 'timestamp', 'nextOccurrence', 'endDate'];
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
     * Clear all data (for testing/reset)
     */
    async clearAll(): Promise<void> {
        if (!this.db) return;
        const storeNames = Array.from(this.db.objectStoreNames);
        const transaction = this.db.transaction(storeNames, 'readwrite');

        await Promise.all(storeNames.map(storeName => {
            return new Promise<void>((resolve, reject) => {
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }));
    }

    /**
     * Get storage usage estimate
     */
    async getStorageEstimate(): Promise<{ usage: number; quota: number }> {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
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
