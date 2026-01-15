import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecurringTaskService } from '../recurringTaskService';
import { Task, RecurringConfig } from '../../../types';

describe('RecurringTaskService', () => {
    let service: RecurringTaskService;
    const mockOnCreate = vi.fn();
    const mockOnUpdate = vi.fn();

    beforeEach(() => {
        service = new RecurringTaskService({
            onCreateTask: mockOnCreate,
            onUpdateTask: mockOnUpdate,
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        service.stop();
    });

    describe('calculateNextOccurrence', () => {
        it('should calculate next daily occurrence correctly', () => {
            const config: RecurringConfig = {
                frequency: 'daily',
                interval: 1,
                enabled: true
            };
            const baseDate = new Date('2024-01-01T10:00:00');
            const next = service.calculateNextOccurrence(config, baseDate);

            expect(next.toISOString()).toContain('2024-01-02');
        });

        it('should calculate next weekly occurrence correctly', () => {
            const config: RecurringConfig = {
                frequency: 'weekly',
                interval: 1,
                enabled: true
            };
            const baseDate = new Date('2024-01-01T10:00:00'); // Monday
            const next = service.calculateNextOccurrence(config, baseDate);

            expect(next.toISOString()).toContain('2024-01-08'); // Next Monday
        });

        it('should calculate specific days of week correctly', () => {
            const config: RecurringConfig = {
                frequency: 'weekly',
                interval: 1,
                enabled: true,
                daysOfWeek: [1, 3, 5] // Mon, Wed, Fri
            };
            // Monday
            let baseDate = new Date('2024-01-01T10:00:00'); // Mon
            let next = service.calculateNextOccurrence(config, baseDate);
            expect(next.getDay()).toBe(3); // Expect Wednesday

            // Wednesday
            baseDate = new Date('2024-01-03T10:00:00'); // Wed
            next = service.calculateNextOccurrence(config, baseDate);
            expect(next.getDay()).toBe(5); // Expect Friday

            // Friday
            baseDate = new Date('2024-01-05T10:00:00'); // Fri
            next = service.calculateNextOccurrence(config, baseDate);
            expect(next.getDay()).toBe(1); // Expect Monday next week
        });
    });

    describe('checkAndGenerate', () => {
        it('should generate new task when due', () => {
            const now = new Date();
            const pastDate = new Date(now.getTime() - 10000); // 10s ago

            const task: Task = {
                id: 't1',
                jobId: 'job-1',
                title: 'Recurring Task',
                subtitle: '',
                summary: '',
                status: 'todo',
                projectId: 'p1',
                createdAt: now,
                updatedAt: now,
                priority: 'medium',
                assignee: '',
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
                recurring: {
                    enabled: true,
                    frequency: 'daily',
                    interval: 1,
                    nextOccurrence: pastDate
                }
            };

            service.start([task]);

            expect(mockOnCreate).toHaveBeenCalled();
            expect(mockOnUpdate).toHaveBeenCalled();

            // Check created task
            const createdTask = mockOnCreate.mock.calls[0][0];
            expect(createdTask.title).toBe(task.title);
            expect(createdTask.id).not.toBe(task.id);
        });

        it('should not generate task if not due', () => {
            const now = new Date();
            const futureDate = new Date(now.getTime() + 10000); // 10s future

            const task: Task = {
                id: 't1',
                jobId: 'job-1',
                title: 'Future Task',
                subtitle: '',
                summary: '',
                status: 'todo',
                projectId: 'p1',
                createdAt: now,
                updatedAt: now,
                priority: 'medium',
                assignee: '',
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
                recurring: {
                    enabled: true,
                    frequency: 'daily',
                    interval: 1,
                    nextOccurrence: futureDate
                }
            };

            service.start([task]);
            expect(mockOnCreate).not.toHaveBeenCalled();
        });
    });
});
