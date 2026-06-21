import type { Task } from "../../types";
import { indexedDBService } from "./indexedDBService";
import storageService from "./storageService";

export interface ArchiveConfig {
  autoArchiveAfterDays: number;
  archiveCompleted: boolean;
  archiveStorage: "indexedDB" | "file" | "localStorage";
}

const ARCHIVE_STORAGE_KEY = "liquitask-archived-tasks";

export class ArchiveService {
  private archivedTasks: Task[] = [];

  /**
   * Initialize archive service - load archived tasks.
   *
   * Archived tasks live in IndexedDB (larger quota than localStorage). On first
   * run after upgrade, any legacy localStorage archive is migrated into
   * IndexedDB and then removed from localStorage to free that quota. When
   * IndexedDB is unavailable, falls back to localStorage.
   */
  async initialize(): Promise<void> {
    if (!indexedDBService.isAvailable()) {
      this.archivedTasks = storageService.get<Task[]>(ARCHIVE_STORAGE_KEY, []);
      return;
    }

    const fromIdb = await indexedDBService.getAllArchivedTasks();
    if (fromIdb.length > 0) {
      this.archivedTasks = fromIdb;
      return;
    }

    // Nothing in IndexedDB yet — migrate any legacy localStorage archive.
    const legacy = storageService.get<Task[]>(ARCHIVE_STORAGE_KEY, []);
    if (legacy.length > 0) {
      this.archivedTasks = legacy;
      try {
        await indexedDBService.saveArchivedTasks(legacy);
        // Only drop the localStorage copy after the IndexedDB write succeeds, so
        // a failure can never lose the archive.
        storageService.remove(ARCHIVE_STORAGE_KEY);
      } catch (e) {
        console.error("Failed to migrate archived tasks to IndexedDB:", e);
      }
      return;
    }

    this.archivedTasks = [];
  }

  /**
   * Persist the current archived-tasks set to the active backend.
   */
  private async persist(): Promise<void> {
    if (indexedDBService.isAvailable()) {
      await indexedDBService.saveArchivedTasks(this.archivedTasks);
    } else {
      await storageService.set(ARCHIVE_STORAGE_KEY, this.archivedTasks);
    }
  }

  /**
   * Archive tasks based on configuration
   */
  async archiveTasks(tasks: Task[], config: ArchiveConfig): Promise<Task[]> {
    const now = new Date();
    const archiveDate = new Date(now.getTime() - config.autoArchiveAfterDays * 24 * 60 * 60 * 1000);

    const toArchive = tasks.filter((task) => {
      if (
        config.archiveCompleted &&
        task.status === "Completed" &&
        task.completedAt &&
        new Date(task.completedAt) < archiveDate
      )
        return true;
      return false;
    });

    if (toArchive.length === 0) return tasks;

    // Move to archive storage
    await this.moveToArchive(toArchive);

    // Return remaining active tasks
    return tasks.filter((t) => !toArchive.includes(t));
  }

  /**
   * Move tasks to archive storage
   */
  private async moveToArchive(tasks: Task[]): Promise<void> {
    this.archivedTasks = [...this.archivedTasks, ...tasks];
    await this.persist();
  }

  /**
   * Archive a known active task.
   */
  async archiveTask(task: Task): Promise<void> {
    if (this.archivedTasks.some(t => t.id === task.id)) return;
    await this.moveToArchive([task]);
  }

  /**
   * Search archived tasks
   */
  async searchArchive(query: string): Promise<Task[]> {
    const lowerQuery = query.toLowerCase();
    return this.archivedTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(lowerQuery) ||
        task.jobId.toLowerCase().includes(lowerQuery) ||
        (task.summary?.toLowerCase().includes(lowerQuery) ?? false) ||
        (task.assignee?.toLowerCase().includes(lowerQuery) ?? false),
    );
  }

  /**
   * Get all archived tasks
   */
  async getAllArchived(): Promise<Task[]> {
    return [...this.archivedTasks];
  }

  /**
   * Unarchive tasks (move back to active)
   */
  async unarchive(taskIds: string[]): Promise<Task[]> {
    const toUnarchive = this.archivedTasks.filter((t) => taskIds.includes(t.id));
    this.archivedTasks = this.archivedTasks.filter((t) => !taskIds.includes(t.id));
    await this.persist();
    return toUnarchive;
  }

  /**
   * Permanently delete archived tasks
   */
  async deleteArchived(taskIds: string[]): Promise<void> {
    this.archivedTasks = this.archivedTasks.filter((t) => !taskIds.includes(t.id));
    await this.persist();
  }

  /**
   * Get archive statistics
   */
  getArchiveStats(): {
    total: number;
    oldestDate: Date | null;
    newestDate: Date | null;
  } {
    if (this.archivedTasks.length === 0) {
      return { total: 0, oldestDate: null, newestDate: null };
    }

    const dates = this.archivedTasks
      .map((t) => t.completedAt || t.createdAt)
      .filter((d): d is Date => d !== undefined)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      total: this.archivedTasks.length,
      oldestDate: dates[0] || null,
      newestDate: dates[dates.length - 1] || null,
    };
  }
}

// Singleton instance
export const archiveService = new ArchiveService();
