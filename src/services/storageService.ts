import { Task, Project, BoardColumn, ProjectType, PriorityDefinition, CustomFieldDefinition } from '../../types';
import { STORAGE_KEYS, DEFAULT_COLUMNS, DEFAULT_PROJECTS, DEFAULT_PROJECT_TYPES, DEFAULT_PRIORITIES } from '../constants';
import { validateAndTransformImportedData } from '../utils/validation';
import { trySaveToStorage } from '../utils/storageQuota';

// Type guard for Electron environment
function hasElectronAPI(win: Window): win is Window & { electronAPI: NonNullable<typeof window.electronAPI> } {
    return typeof win !== 'undefined' && !!win.electronAPI;
}

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && hasElectronAPI(window);

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
    grouping: 'none' | 'priority';
    version?: string; // Data schema version for migration
}

// Current data schema version
const CURRENT_DATA_VERSION = '1.0.0';

// Parse tasks with proper date handling
function parseTasks(data: Record<string, unknown>[]): Task[] {
    return data.map((t) => ({
        id: t.id as string,
        jobId: t.jobId as string,
        projectId: t.projectId as string,
        title: (t.title as string) || '',
        subtitle: (t.subtitle as string) || '',
        summary: (t.summary as string) || '',
        assignee: (t.assignee as string) || '',
        priority: (t.priority as string) || 'medium',
        status: t.status as string,
        createdAt: new Date(t.createdAt as string | number | Date),
        dueDate: t.dueDate ? new Date(t.dueDate as string | number | Date) : undefined,
        subtasks: (t.subtasks as Task['subtasks']) || [],
        attachments: (t.attachments as Task['attachments']) || [],
        customFieldValues: (t.customFieldValues as Task['customFieldValues']) || {},
        links: (t.links as Task['links']) || [],
        tags: (t.tags as string[]) || [],
        timeEstimate: (t.timeEstimate as number) || 0,
        timeSpent: (t.timeSpent as number) || 0,
    }));
}

// Storage service with localStorage fallback
class StorageService {
    private cache: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue: T): T {
        // Check cache first
        if (this.cache.has(key)) {
            return this.cache.get(key) as T;
        }

        try {
            const stored = localStorage.getItem(key);
            if (stored) {
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

    async initialize(): Promise<void> {
        if (!isElectron) return;

        try {
            // Load all keys from native storage
            const keys = Object.values(STORAGE_KEYS);
            for (const key of keys) {
                const value = await window.electronAPI!.storage.get(key);

                if (value) {
                    if (key === STORAGE_KEYS.TASKS) {
                        this.cache.set(key, parseTasks(value as Record<string, unknown>[]));
                    } else {
                        this.cache.set(key, value);
                    }
                } else {
                    // Fallback to localStorage (Migration)
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
                            await window.electronAPI!.storage.set(key, parsed);
                            // Migration complete for key
                        } catch (e) {
                            console.error(`Failed to migrate ${key}`, e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to initialize storage service:', error);
        }
    }

    set<T>(key: string, value: T): void {
        this.cache.set(key, value);

        if (isElectron) {
            // Native Save
            window.electronAPI!.storage.set(key, value).catch(console.error);
        }

        // Always save to localStorage as backup/fallback for now (or strictly separate)
        // For now, let's keep localStorage sync as well to be safe, or conditionally:
        if (!isElectron) {
            try {
                const serialized = JSON.stringify(value);
                const result = trySaveToStorage(key, serialized);
                if (!result.success) throw new Error(result.error);
            } catch (e) {
                console.error(`Failed to save ${key}:`, e);
            }
        }
    }

    remove(key: string): void {
        this.cache.delete(key);
        if (isElectron) {
            window.electronAPI!.storage.delete(key).catch(console.error);
        }
        localStorage.removeItem(key);
    }

    clear(): void {
        this.cache.clear();
        if (isElectron) {
            window.electronAPI!.storage.clear().catch(console.error);
        }
        Object.values(STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    }

    // Get all app data
    getAllData(): Partial<AppData> {
        return {
            columns: this.get(STORAGE_KEYS.COLUMNS, [...DEFAULT_COLUMNS] as BoardColumn[]),
            projectTypes: this.get(STORAGE_KEYS.PROJECT_TYPES, [...DEFAULT_PROJECT_TYPES] as ProjectType[]),
            priorities: this.get(STORAGE_KEYS.PRIORITIES, [...DEFAULT_PRIORITIES] as PriorityDefinition[]),
            customFields: this.get(STORAGE_KEYS.CUSTOM_FIELDS, [] as CustomFieldDefinition[]),
            projects: this.get(STORAGE_KEYS.PROJECTS, [...DEFAULT_PROJECTS] as Project[]),
            tasks: this.get(STORAGE_KEYS.TASKS, [] as Task[]),
            activeProjectId: this.get(STORAGE_KEYS.ACTIVE_PROJECT, 'p1'),
            sidebarCollapsed: this.get(STORAGE_KEYS.SIDEBAR_COLLAPSED, false),
            grouping: this.get(STORAGE_KEYS.GROUPING, 'none'),
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
    importData(jsonString: string): { data: Partial<AppData> | null; error?: string } {
        try {
            const parsed = JSON.parse(jsonString);

            // Check version and migrate if needed
            const importedVersion = parsed.version || '0.0.0';
            if (importedVersion !== CURRENT_DATA_VERSION) {
                // Future: Add migration logic here for version upgrade
                // Future: Add migration logic here
            }

            // Validate with Zod schema
            const validated = validateAndTransformImportedData(parsed);

            if (!validated) {
                return { data: null, error: 'Validation failed' };
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
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            console.error('Failed to import data:', e);
            return { data: null, error: errorMessage };
        }
    }
}

// Singleton instance
export const storageService = new StorageService();
export default storageService;
