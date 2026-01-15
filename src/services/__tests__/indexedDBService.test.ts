import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IndexedDBService } from '../indexedDBService';
import 'fake-indexeddb/auto';
import { Task, Project } from '../../../types';

describe('IndexedDBService', () => {
    let service: IndexedDBService;

    beforeEach(async () => {
        service = new IndexedDBService();
        await service.initialize();
        await service.clearAll();
    });

    afterEach(async () => {
        // Cleanup if needed
        vi.clearAllMocks();
    });

    it('should initialize successfully', async () => {
        expect(service.isAvailable()).toBe(true);
    });

    it('should save and get a task', async () => {
        const task: Task = {
            id: 'task-1',
            jobId: 'job-1',
            title: 'Test Task',
            subtitle: '',
            summary: '',
            status: 'todo',
            projectId: 'project-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            priority: 'medium',
            assignee: '',
            subtasks: [],
            attachments: [],
            tags: [],
            timeEstimate: 0,
            timeSpent: 0
        };

        await service.saveTask(task);
        const savedTasks = await service.getAllTasks();
        expect(savedTasks).toHaveLength(1);
        expect(savedTasks[0].id).toBe(task.id);
        expect(savedTasks[0].title).toBe(task.title);
    });

    it('should delete a task', async () => {
        const task: Task = {
            id: 'task-1',
            jobId: 'job-1',
            title: 'Test Task',
            subtitle: '',
            summary: '',
            status: 'todo',
            projectId: 'project-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            priority: 'medium',
            assignee: '',
            subtasks: [],
            attachments: [],
            tags: [],
            timeEstimate: 0,
            timeSpent: 0
        };

        await service.saveTask(task);
        await service.deleteTask('task-1');
        const savedTasks = await service.getAllTasks();
        expect(savedTasks).toHaveLength(0);
    });

    it('should save and get projects', async () => {
        const project: Project = {
            id: 'proj-1',
            name: 'Test Project',
            type: 'default',
            icon: 'star'
        };

        await service.saveProject(project);
        const savedProjects = await service.getAllProjects();
        expect(savedProjects).toHaveLength(1);
        expect(savedProjects[0].id).toBe(project.id);
    });
});
