import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveService, ArchiveConfig } from '../archiveService';
import storageService from '../storageService';
import { Task } from '../../types';

vi.mock('../storageService', () => ({
    default: {
        get: vi.fn(),
        set: vi.fn(),
    }
}));

describe('ArchiveService', () => {
    let service: ArchiveService;

    const mockTasks: Task[] = [
        { id: '1', title: 'Task 1', status: 'Completed', completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), jobId: 'T1', tags: [], createdAt: new Date() } as Task,
        { id: '2', title: 'Task 2', status: 'Todo', jobId: 'T2', tags: [], createdAt: new Date() } as Task,
        { id: '3', title: 'Task 3', status: 'Completed', completedAt: new Date(), jobId: 'T3', tags: [], createdAt: new Date() } as Task
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ArchiveService();
    });

    it('should initialize and load archived tasks', async () => {
        vi.mocked(storageService.get).mockReturnValue([mockTasks[0]]);
        await service.initialize();
        expect(await service.getAllArchived()).toHaveLength(1);
        expect(storageService.get).toHaveBeenCalledWith('liquitask-archived-tasks', []);
    });

    it('should archive tasks based on config (archiveCompleted)', async () => {
        const config: ArchiveConfig = {
            autoArchiveAfterDays: 30,
            archiveCompleted: true,
            archiveStorage: 'localStorage'
        };

        const activeTasks = await service.archiveTasks(mockTasks, config);
        expect(activeTasks).toHaveLength(1); // Only Task 2 remains
        expect(activeTasks[0].id).toBe('2');
        expect(await service.getAllArchived()).toHaveLength(2); // Task 1 and 3 archived
    });

    it('should archive tasks based on age', async () => {
        const config: ArchiveConfig = {
            autoArchiveAfterDays: 5,
            archiveCompleted: false,
            archiveStorage: 'localStorage'
        };

        const activeTasks = await service.archiveTasks(mockTasks, config);
        expect(activeTasks).toHaveLength(2); // Task 2 and 3 remain
        expect(await service.getAllArchived()).toHaveLength(1); // Only Task 1 (10 days old) archived
    });

    it('should search archived tasks', async () => {
        vi.mocked(storageService.get).mockReturnValue(mockTasks);
        await service.initialize();

        const results = await service.searchArchive('Task 1');
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('1');
    });

    it('should unarchive tasks', async () => {
        vi.mocked(storageService.get).mockReturnValue(mockTasks);
        await service.initialize();

        const toUnarchive = await service.unarchive(['1', '2']);
        expect(toUnarchive).toHaveLength(2);
        expect(await service.getAllArchived()).toHaveLength(1);
        expect(storageService.set).toHaveBeenCalled();
    });

    it('should permanently delete archived tasks', async () => {
        vi.mocked(storageService.get).mockReturnValue(mockTasks);
        await service.initialize();

        await service.deleteArchived(['1']);
        expect(await service.getAllArchived()).toHaveLength(2);
        expect(storageService.set).toHaveBeenCalled();
    });

    it('should get archive stats', async () => {
        vi.mocked(storageService.get).mockReturnValue([mockTasks[0], mockTasks[2]]);
        await service.initialize();

        const stats = service.getArchiveStats();
        expect(stats.total).toBe(2);
        expect(stats.oldestDate).not.toBeNull();
        expect(stats.newestDate).not.toBeNull();
    });
});
