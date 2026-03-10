import { describe, it, expect, beforeEach } from 'vitest';
import { SearchIndexService } from '../searchIndexService';
import { Task } from '../../types';

describe('SearchIndexService', () => {
    let service: SearchIndexService;

    const mockTasks: Task[] = [
        {
            id: '1',
            jobId: 'LT-101',
            title: 'Fix navigation bug',
            summary: 'The navigation bar is not working correctly on mobile devices.',
            tags: ['bug', 'frontend'],
            assignee: 'Alice',
            status: 'Todo',
            projectId: 'p1',
            createdAt: new Date(),
            updatedAt: new Date(),
            subtasks: [],
            attachments: [],
            comments: [],
            activity: []
        } as Task,
        {
            id: '2',
            jobId: 'LT-102',
            title: 'Implement search feature',
            summary: 'Add a new search functionality to the task board.',
            tags: ['feature', 'backend'],
            assignee: 'Bob',
            status: 'In Progress',
            projectId: 'p1',
            createdAt: new Date(),
            updatedAt: new Date(),
            subtasks: [],
            attachments: [],
            comments: [],
            activity: []
        } as Task,
        {
            id: '3',
            jobId: 'LT-103',
            title: 'Update documentation',
            summary: 'Review and update the project documentation for the latest release.',
            tags: ['docs'],
            assignee: 'Alice',
            status: 'Completed',
            projectId: 'p2',
            createdAt: new Date(),
            updatedAt: new Date(),
            subtasks: [],
            attachments: [],
            comments: [],
            activity: []
        } as Task
    ];

    beforeEach(() => {
        service = new SearchIndexService();
    });

    it('should build index from tasks', () => {
        service.buildIndex(mockTasks);
        const stats = service.getStats();
        expect(stats.totalJobIds).toBe(3);
        expect(stats.totalTags).toBe(5);
        expect(stats.totalAssignees).toBe(2); // Alice, Bob
    });

    it('should search tasks by title words', () => {
        service.buildIndex(mockTasks);
        const results = service.search('navigation');
        expect(results).toContain('1');
        expect(results).not.toContain('2');
    });

    it('should search tasks by jobId', () => {
        service.buildIndex(mockTasks);
        const results = service.search('LT-101');
        expect(results).toContain('1');
    });

    it('should search tasks by partial jobId', () => {
        service.buildIndex(mockTasks);
        const results = service.search('102');
        expect(results).toContain('2');
    });

    it('should search tasks by tags', () => {
        service.buildIndex(mockTasks);
        const results = service.search('frontend');
        expect(results).toContain('1');
    });

    it('should search tasks by assignee', () => {
        service.buildIndex(mockTasks);
        const results = service.search('Alice');
        expect(results).toContain('1');
        expect(results).toContain('3');
    });

    it('should search tasks by summary words', () => {
        service.buildIndex(mockTasks);
        const results = service.search('mobile');
        expect(results).toContain('1');
    });

    it('should perform AND search for multiple words', () => {
        service.buildIndex(mockTasks);
        const results = service.search('navigation bug');
        expect(results).toContain('1');
        expect(results).not.toContain('2');

        const results2 = service.search('Alice documentation');
        expect(results2).toContain('3');
        expect(results2).not.toContain('1');
    });

    it('should return empty array for empty query', () => {
        service.buildIndex(mockTasks);
        expect(service.search('')).toEqual([]);
        expect(service.search('  ')).toEqual([]);
    });

    it('should search with regex', () => {
        service.buildIndex(mockTasks);
        const results = service.searchWithRegex('navigat.*');
        expect(results).toContain('1');

        const results2 = service.searchWithRegex('LT-10[12]');
        expect(results2).toContain('1');
        expect(results2).toContain('2');
        expect(results2).not.toContain('3');
    });

    it('should fallback to normal search for invalid regex', () => {
        service.buildIndex(mockTasks);
        const results = service.searchWithRegex('('); // Invalid regex
        expect(results).toEqual([]); // Normal search for '(' returns nothing because it's too short or stripped
    });

    it('should update task in index', () => {
        service.buildIndex(mockTasks);
        const updatedTask = { ...mockTasks[0], title: 'Fix CSS issue', summary: 'New summary' };
        service.updateTask(updatedTask, mockTasks[0]);

        expect(service.search('navigation')).not.toContain('1');
        expect(service.search('issue')).toContain('1');
    });

    it('should remove task from index', () => {
        service.buildIndex(mockTasks);
        service.removeTask(mockTasks[0]);
        expect(service.search('navigation')).not.toContain('1');
        expect(service.getStats().totalJobIds).toBe(2);
    });

    it('should handle tasks without summary or assignee', () => {
        const minimalTask = {
            id: '4',
            jobId: 'LT-104',
            title: 'Minimal task',
            tags: [],
            status: 'Todo',
            projectId: 'p1',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as Task;
        service.buildIndex([minimalTask]);
        expect(service.getStats().totalAssignees).toBe(0);
        expect(service.search('minimal')).toContain('4');
    });
});
