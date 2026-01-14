import { describe, it, expect } from 'vitest';
import { activityService } from '../activityService';
import { Task } from '../../../types';

describe('activityService', () => {
    describe('createActivity', () => {
        it('should create an activity item with correct properties', () => {
            const activity = activityService.createActivity('create', 'Task created');

            expect(activity.id).toMatch(/^act-/);
            expect(activity.type).toBe('create');
            expect(activity.details).toBe('Task created');
            expect(activity.timestamp).toBeInstanceOf(Date);
            expect(activity.userId).toBe('current-user');
        });

        it('should include optional fields', () => {
            const activity = activityService.createActivity('update', 'Updated status', 'status', 'todo', 'in-progress');

            expect(activity.field).toBe('status');
            expect(activity.oldValue).toBe('todo');
            expect(activity.newValue).toBe('in-progress');
        });
    });

    describe('logChange', () => {
        const mockTask: Task = {
            id: 'task-1',
            title: 'Test Task',
            status: 'todo',
            priority: 'low',
            activity: []
        } as unknown as Task;

        it('should log status changes', () => {
            const updatedTask = activityService.logChange(mockTask, { status: 'in-progress' });

            expect(updatedTask.status).toBe('in-progress');
            expect(updatedTask.activity).toHaveLength(1);
            expect(updatedTask.activity![0].type).toBe('move');
            expect(updatedTask.activity![0].field).toBe('status');
        });

        it('should log priority changes', () => {
            const updatedTask = activityService.logChange(mockTask, { priority: 'high' });

            expect(updatedTask.priority).toBe('high');
            expect(updatedTask.activity).toHaveLength(1);
            expect(updatedTask.activity![0].field).toBe('priority');
        });

        it('should log multiple changes', () => {
            const updatedTask = activityService.logChange(mockTask, {
                status: 'done',
                priority: 'medium'
            });

            expect(updatedTask.activity).toHaveLength(2);
        });

        it('should log creation if task has no activity and activityType is create', () => {
            const emptyTask = { ...mockTask, activity: [] };
            const updatedTask = activityService.logChange(emptyTask, {}, 'create');

            expect(updatedTask.activity).toHaveLength(1);
            expect(updatedTask.activity![0].type).toBe('create');
        });

        it('should NOT log if values are the same', () => {
            const updatedTask = activityService.logChange(mockTask, { status: 'todo' });
            expect(updatedTask.activity).toHaveLength(0);
        });
    });
});
