import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskManagement } from '../useTaskManagement';
import { Task, BoardColumn } from '../../../types';
import { storageService } from '../../services/storageService';
import { STORAGE_KEYS, COLUMN_STATUS } from '../../constants';

// Mock storage service
vi.mock('../../services/storageService', () => ({
    storageService: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

describe('useTaskManagement', () => {
    const mockColumns: BoardColumn[] = [
        { id: COLUMN_STATUS.PENDING, title: 'Pending', color: '#64748b' },
        { id: COLUMN_STATUS.IN_PROGRESS, title: 'In Progress', color: '#3b82f6' },
        { id: COLUMN_STATUS.COMPLETED, title: 'Completed', color: '#10b981', isCompleted: true },
    ];

    const mockAddToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([]);
    });

    describe('initialization', () => {
        it('should initialize with empty tasks', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            expect(result.current.tasks).toEqual([]);
        });

        it('should load tasks from storage', () => {
            const storedTasks: Task[] = [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Test Task',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: COLUMN_STATUS.PENDING,
                    createdAt: new Date(),
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
            ];

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(storedTasks);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            expect(result.current.tasks).toHaveLength(1);
            expect(result.current.tasks[0].title).toBe('Test Task');
        });
    });

    describe('createTask', () => {
        it('should create a new task with default values', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.createTask({ title: 'New Task' });
            });

            expect(result.current.tasks).toHaveLength(1);
            expect(result.current.tasks[0].title).toBe('New Task');
            expect(result.current.tasks[0].projectId).toBe('p1');
            expect(result.current.tasks[0].status).toBe(COLUMN_STATUS.PENDING);
            expect(result.current.tasks[0].priority).toBe('medium');
            expect(mockAddToast).toHaveBeenCalledWith('Task created successfully', 'success');
        });

        it('should create task with all provided fields', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.createTask({
                    title: 'Full Task',
                    subtitle: 'Subtitle',
                    summary: 'Summary',
                    assignee: 'John',
                    priority: 'high',
                    status: COLUMN_STATUS.IN_PROGRESS,
                    tags: ['urgent'],
                    timeEstimate: 120,
                });
            });

            const task = result.current.tasks[0];
            expect(task.title).toBe('Full Task');
            expect(task.subtitle).toBe('Subtitle');
            expect(task.assignee).toBe('John');
            expect(task.priority).toBe('high');
            expect(task.status).toBe(COLUMN_STATUS.IN_PROGRESS);
            expect(task.tags).toEqual(['urgent']);
            expect(task.timeEstimate).toBe(120);
        });

        it('should save task to storage', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.createTask({ title: 'New Task' });
            });

            expect(storageService.set).toHaveBeenCalledWith(
                STORAGE_KEYS.TASKS,
                expect.arrayContaining([expect.objectContaining({ title: 'New Task' })])
            );
        });
    });

    describe('updateTask', () => {
        it('should update an existing task', () => {
            const initialTask: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Original Title',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([initialTask]);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.updateTask({
                    ...initialTask,
                    title: 'Updated Title',
                    priority: 'high',
                });
            });

            expect(result.current.tasks[0].title).toBe('Updated Title');
            expect(result.current.tasks[0].priority).toBe('high');
            expect(result.current.tasks[0].updatedAt).toBeInstanceOf(Date);
        });
    });

    describe('deleteTask', () => {
        it('should delete a task', () => {
            const task: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Task to Delete',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([task]);
            window.confirm = vi.fn(() => true);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.deleteTask('task-1');
            });

            expect(result.current.tasks).toHaveLength(0);
            expect(mockAddToast).toHaveBeenCalledWith('Task deleted (Ctrl+Z to undo)', 'info');
        });

        it('should not delete if user cancels', () => {
            const task: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([task]);
            window.confirm = vi.fn(() => false);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.deleteTask('task-1');
            });

            expect(result.current.tasks).toHaveLength(1);
        });

        it('should skip confirmation when skipConfirm is true', () => {
            const task: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([task]);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.deleteTask('task-1', true);
            });

            expect(result.current.tasks).toHaveLength(0);
            expect(window.confirm).not.toHaveBeenCalled();
        });
    });

    describe('moveTask', () => {
        it('should move task to new status', () => {
            const task: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([task]);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.moveTask('task-1', COLUMN_STATUS.IN_PROGRESS);
            });

            expect(result.current.tasks[0].status).toBe(COLUMN_STATUS.IN_PROGRESS);
        });

        it('should prevent move if blocked by dependency', () => {
            const blocker: Task = {
                id: 'task-blocker',
                jobId: 'TSK-2001',
                projectId: 'p1',
                title: 'Blocker',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'high',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            const blocked: Task = {
                id: 'task-blocked',
                jobId: 'TSK-2002',
                projectId: 'p1',
                title: 'Blocked Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                links: [{ targetTaskId: 'task-blocker', type: 'blocked-by' }],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([blocker, blocked]);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.moveTask('task-blocked', COLUMN_STATUS.IN_PROGRESS);
            });

            expect(result.current.tasks.find(t => t.id === 'task-blocked')?.status).toBe(COLUMN_STATUS.PENDING);
            expect(mockAddToast).toHaveBeenCalledWith(
                expect.stringContaining('Cannot start: Blocked by task'),
                'error'
            );
        });

        it('should allow move if blocker is completed', () => {
            const blocker: Task = {
                id: 'task-blocker',
                jobId: 'TSK-2001',
                projectId: 'p1',
                title: 'Blocker',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'high',
                status: COLUMN_STATUS.COMPLETED,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            const blocked: Task = {
                id: 'task-blocked',
                jobId: 'TSK-2002',
                projectId: 'p1',
                title: 'Blocked Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                links: [{ targetTaskId: 'task-blocker', type: 'blocked-by' }],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([blocker, blocked]);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.moveTask('task-blocked', COLUMN_STATUS.IN_PROGRESS);
            });

            expect(result.current.tasks.find(t => t.id === 'task-blocked')?.status).toBe(COLUMN_STATUS.IN_PROGRESS);
        });
    });

    describe('bulkCreateTasks', () => {
        it('should create multiple tasks', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.bulkCreateTasks([
                    { title: 'Task 1' },
                    { title: 'Task 2' },
                    { title: 'Task 3' },
                ]);
            });

            expect(result.current.tasks).toHaveLength(3);
            expect(mockAddToast).toHaveBeenCalledWith('Generated 3 tasks', 'success');
        });

        it('should set default values for bulk created tasks', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.bulkCreateTasks([{ title: 'Bulk Task' }]);
            });

            const task = result.current.tasks[0];
            expect(task.subtitle).toBe('AI Generated');
            expect(task.status).toBe(COLUMN_STATUS.PENDING);
            expect(task.priority).toBe('medium');
        });
    });

    describe('getProjectTasks', () => {
        it('should return tasks for specific project', () => {
            const tasks: Task[] = [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task 1',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: COLUMN_STATUS.PENDING,
                    createdAt: new Date(),
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
                {
                    id: 'task-2',
                    jobId: 'TSK-1002',
                    projectId: 'p2',
                    title: 'Task 2',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: COLUMN_STATUS.PENDING,
                    createdAt: new Date(),
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
            ];

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(tasks);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            const projectTasks = result.current.getProjectTasks('p1');
            expect(projectTasks).toHaveLength(1);
            expect(projectTasks[0].id).toBe('task-1');
        });
    });

    describe('undo', () => {
        it('should undo task creation', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.createTask({ title: 'Task to Undo' });
            });

            expect(result.current.tasks).toHaveLength(1);

            act(() => {
                result.current.undo();
            });

            expect(result.current.tasks).toHaveLength(0);
            expect(mockAddToast).toHaveBeenCalledWith('Task creation undone', 'info');
        });

        it('should undo task deletion', () => {
            const task: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([task]);
            window.confirm = vi.fn(() => true);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.deleteTask('task-1');
            });

            expect(result.current.tasks).toHaveLength(0);

            act(() => {
                result.current.undo();
            });

            expect(result.current.tasks).toHaveLength(1);
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Restored'), 'success');
        });

        it('should undo task update', () => {
            const task: Task = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Original',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'medium',
                status: COLUMN_STATUS.PENDING,
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([task]);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.updateTask({ ...task, title: 'Updated' });
            });

            expect(result.current.tasks[0].title).toBe('Updated');

            act(() => {
                result.current.undo();
            });

            expect(result.current.tasks[0].title).toBe('Original');
            expect(mockAddToast).toHaveBeenCalledWith('Change undone', 'info');
        });

        it('should show message when nothing to undo', () => {
            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            act(() => {
                result.current.undo();
            });

            expect(mockAddToast).toHaveBeenCalledWith('Nothing to undo', 'info');
        });
    });

    describe('currentProjectTasks', () => {
        it('should filter tasks by active project', () => {
            const tasks: Task[] = [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task 1',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: COLUMN_STATUS.PENDING,
                    createdAt: new Date(),
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
                {
                    id: 'task-2',
                    jobId: 'TSK-1002',
                    projectId: 'p2',
                    title: 'Task 2',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: COLUMN_STATUS.PENDING,
                    createdAt: new Date(),
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
            ];

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(tasks);

            const { result } = renderHook(() =>
                useTaskManagement({
                    activeProjectId: 'p1',
                    columns: mockColumns,
                    addToast: mockAddToast,
                })
            );

            expect(result.current.currentProjectTasks).toHaveLength(1);
            expect(result.current.currentProjectTasks[0].id).toBe('task-1');
        });
    });
});

