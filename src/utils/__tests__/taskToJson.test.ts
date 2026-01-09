import { describe, it, expect } from 'vitest';
import { taskToJson } from '../taskToJson';
import { Task } from '../../../types';

describe('taskToJson', () => {
    const baseTask: Task = {
        id: 'task-1',
        jobId: 'TSK-1001',
        projectId: 'p1',
        title: 'Test Task',
        subtitle: '',
        summary: '',
        assignee: '',
        priority: 'medium',
        status: 'Pending',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
    };

    it('should convert task to JSON string', () => {
        const json = taskToJson(baseTask);
        const parsed = JSON.parse(json);

        expect(parsed.id).toBe('task-1');
        expect(parsed.jobId).toBe('TSK-1001');
        expect(parsed.title).toBe('Test Task');
    });

    it('should include project name when provided', () => {
        const json = taskToJson(baseTask, 'My Project');
        const parsed = JSON.parse(json);

        expect(parsed.project).toBe('My Project');
    });

    it('should use projectId when project name not provided', () => {
        const json = taskToJson(baseTask);
        const parsed = JSON.parse(json);

        expect(parsed.project).toBe('p1');
    });

    it('should format dates as ISO strings', () => {
        const taskWithDates: Task = {
            ...baseTask,
            updatedAt: new Date('2024-01-02T00:00:00.000Z'),
            dueDate: new Date('2024-01-15T00:00:00.000Z'),
            completedAt: new Date('2024-01-20T00:00:00.000Z'),
        };

        const json = taskToJson(taskWithDates);
        const parsed = JSON.parse(json);

        expect(parsed.createdAt).toBe('2024-01-01T00:00:00.000Z');
        expect(parsed.updatedAt).toBe('2024-01-02T00:00:00.000Z');
        expect(parsed.dueDate).toBe('2024-01-15T00:00:00.000Z');
        expect(parsed.completedAt).toBe('2024-01-20T00:00:00.000Z');
    });

    it('should format time estimates in hours', () => {
        const taskWithTime: Task = {
            ...baseTask,
            timeEstimate: 120, // 2 hours
            timeSpent: 60, // 1 hour
        };

        const json = taskToJson(taskWithTime);
        const parsed = JSON.parse(json);

        expect(parsed.timeEstimate).toBe('2 hours');
        expect(parsed.timeEstimateMinutes).toBe(120);
        expect(parsed.timeSpent).toBe('1 hours');
        expect(parsed.timeSpentMinutes).toBe(60);
    });

    it('should not include time fields when zero', () => {
        const json = taskToJson(baseTask);
        const parsed = JSON.parse(json);

        expect(parsed.timeEstimate).toBeUndefined();
        expect(parsed.timeSpent).toBeUndefined();
    });

    it('should include subtasks when present', () => {
        const taskWithSubtasks: Task = {
            ...baseTask,
            subtasks: [
                { id: 'sub-1', title: 'Subtask 1', completed: false },
                { id: 'sub-2', title: 'Subtask 2', completed: true },
            ],
        };

        const json = taskToJson(taskWithSubtasks);
        const parsed = JSON.parse(json);

        expect(parsed.subtasks).toHaveLength(2);
        expect(parsed.subtasks[0].title).toBe('Subtask 1');
        expect(parsed.subtasks[0].completed).toBe(false);
        expect(parsed.subtasks[1].completed).toBe(true);
    });

    it('should not include subtasks when empty', () => {
        const json = taskToJson(baseTask);
        const parsed = JSON.parse(json);

        expect(parsed.subtasks).toBeUndefined();
    });

    it('should include attachments when present', () => {
        const taskWithAttachments: Task = {
            ...baseTask,
            attachments: [
                { id: 'att-1', name: 'file.pdf', url: 'https://example.com/file.pdf', type: 'file' },
                { id: 'att-2', name: 'Link', url: 'https://example.com', type: 'link' },
            ],
        };

        const json = taskToJson(taskWithAttachments);
        const parsed = JSON.parse(json);

        expect(parsed.attachments).toHaveLength(2);
        expect(parsed.attachments[0].name).toBe('file.pdf');
        expect(parsed.attachments[0].type).toBe('file');
    });

    it('should include task links when present', () => {
        const taskWithLinks: Task = {
            ...baseTask,
            links: [
                { targetTaskId: 'task-2', type: 'blocks' },
                { targetTaskId: 'task-3', type: 'blocked-by' },
            ],
        };

        const json = taskToJson(taskWithLinks);
        const parsed = JSON.parse(json);

        expect(parsed.links).toHaveLength(2);
        expect(parsed.links[0].type).toBe('blocks');
        expect(parsed.links[0].targetTaskId).toBe('task-2');
    });

    it('should include custom field values when present', () => {
        const taskWithCustomFields: Task = {
            ...baseTask,
            customFieldValues: {
                'field-1': 'Value 1',
                'field-2': 42,
            },
        };

        const json = taskToJson(taskWithCustomFields);
        const parsed = JSON.parse(json);

        expect(parsed.customFieldValues).toEqual({
            'field-1': 'Value 1',
            'field-2': 42,
        });
    });

    it('should include tags when present', () => {
        const taskWithTags: Task = {
            ...baseTask,
            tags: ['urgent', 'important', 'bug'],
        };

        const json = taskToJson(taskWithTags);
        const parsed = JSON.parse(json);

        expect(parsed.tags).toEqual(['urgent', 'important', 'bug']);
    });

    it('should include recurring config when present', () => {
        const taskWithRecurring: Task = {
            ...baseTask,
            recurring: {
                enabled: true,
                frequency: 'weekly',
                interval: 2,
                daysOfWeek: [1, 3, 5],
                endDate: new Date('2024-12-31T00:00:00.000Z'),
                nextOccurrence: new Date('2024-01-08T00:00:00.000Z'),
            },
        };

        const json = taskToJson(taskWithRecurring);
        const parsed = JSON.parse(json);

        expect(parsed.recurring.enabled).toBe(true);
        expect(parsed.recurring.frequency).toBe('weekly');
        expect(parsed.recurring.interval).toBe(2);
        expect(parsed.recurring.daysOfWeek).toEqual([1, 3, 5]);
        expect(parsed.recurring.endDate).toBe('2024-12-31T00:00:00.000Z');
    });

    it('should include error logs when present', () => {
        const taskWithErrors: Task = {
            ...baseTask,
            errorLogs: [
                { timestamp: new Date('2024-01-01T00:00:00.000Z'), message: 'Error 1' },
                { timestamp: new Date('2024-01-02T00:00:00.000Z'), message: 'Error 2' },
            ],
        };

        const json = taskToJson(taskWithErrors);
        const parsed = JSON.parse(json);

        expect(parsed.errorLogs).toHaveLength(2);
        expect(parsed.errorLogs[0].message).toBe('Error 1');
        expect(parsed.errorLogs[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should exclude undefined optional fields', () => {
        const json = taskToJson(baseTask);
        const parsed = JSON.parse(json);

        expect(parsed.subtitle).toBeUndefined();
        expect(parsed.summary).toBeUndefined();
        expect(parsed.assignee).toBeUndefined();
        expect(parsed.updatedAt).toBeUndefined();
        expect(parsed.dueDate).toBeUndefined();
    });

    it('should exclude empty string optional fields', () => {
        const taskWithEmptyStrings: Task = {
            ...baseTask,
            subtitle: '',
            summary: '',
            assignee: '',
        };

        const json = taskToJson(taskWithEmptyStrings);
        const parsed = JSON.parse(json);

        // Empty strings are converted to undefined and excluded
        expect(parsed.subtitle).toBeUndefined();
        expect(parsed.summary).toBeUndefined();
        expect(parsed.assignee).toBeUndefined();
    });

    it('should produce valid JSON', () => {
        const task: Task = {
            ...baseTask,
            subtitle: 'Subtitle',
            summary: 'Summary with "quotes" and\nnewlines',
            assignee: 'John Doe',
            tags: ['tag1', 'tag2'],
            timeEstimate: 120,
            timeSpent: 60,
        };

        const json = taskToJson(task);

        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(parsed.title).toBe('Test Task');
        expect(parsed.summary).toBe('Summary with "quotes" and\nnewlines');
    });
});

