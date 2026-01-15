import { Task } from '../../types';
import storageService from './storageService';


export interface ArchiveConfig {
    autoArchiveAfterDays: number;
    archiveCompleted: boolean;
    archiveStorage: 'indexedDB' | 'file' | 'localStorage';
}

const ARCHIVE_STORAGE_KEY = 'liquitask-archived-tasks';

export class ArchiveService {
    private archivedTasks: Task[] = [];

    /**
     * Initialize archive service - load archived tasks
     */
    async initialize(): Promise<void> {
        this.archivedTasks = storageService.get<Task[]>(ARCHIVE_STORAGE_KEY, []);
    }

    /**
     * Archive tasks based on configuration
     */
    async archiveTasks(tasks: Task[], config: ArchiveConfig): Promise<Task[]> {
        const now = new Date();
        const archiveDate = new Date(now.getTime() - config.autoArchiveAfterDays * 24 * 60 * 60 * 1000);

        const toArchive = tasks.filter(task => {
            if (config.archiveCompleted && task.status === 'Completed') return true;
            if (task.completedAt && task.completedAt < archiveDate) return true;
            return false;
        });

        if (toArchive.length === 0) return tasks;

        // Move to archive storage
        await this.moveToArchive(toArchive);

        // Return remaining active tasks
        return tasks.filter(t => !toArchive.includes(t));
    }

    /**
     * Move tasks to archive storage
     */
    private async moveToArchive(tasks: Task[]): Promise<void> {
        this.archivedTasks = [...this.archivedTasks, ...tasks];
        storageService.set(ARCHIVE_STORAGE_KEY, this.archivedTasks);
    }

    /**
     * Search archived tasks
     */
    async searchArchive(query: string): Promise<Task[]> {
        const lowerQuery = query.toLowerCase();
        return this.archivedTasks.filter(task =>
            task.title.toLowerCase().includes(lowerQuery) ||
            task.jobId.toLowerCase().includes(lowerQuery) ||
            task.summary.toLowerCase().includes(lowerQuery) ||
            task.assignee.toLowerCase().includes(lowerQuery)
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
        const toUnarchive = this.archivedTasks.filter(t => taskIds.includes(t.id));
        this.archivedTasks = this.archivedTasks.filter(t => !taskIds.includes(t.id));
        storageService.set(ARCHIVE_STORAGE_KEY, this.archivedTasks);
        return toUnarchive;
    }

    /**
     * Permanently delete archived tasks
     */
    async deleteArchived(taskIds: string[]): Promise<void> {
        this.archivedTasks = this.archivedTasks.filter(t => !taskIds.includes(t.id));
        storageService.set(ARCHIVE_STORAGE_KEY, this.archivedTasks);
    }

    /**
     * Get archive statistics
     */
    getArchiveStats(): { total: number; oldestDate: Date | null; newestDate: Date | null } {
        if (this.archivedTasks.length === 0) {
            return { total: 0, oldestDate: null, newestDate: null };
        }

        const dates = this.archivedTasks
            .map(t => t.completedAt || t.createdAt)
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
