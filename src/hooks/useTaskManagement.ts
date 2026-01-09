import { useState, useCallback, useMemo, useRef } from 'react';
import { Task, BoardColumn, ToastType } from '../../types';
import { storageService } from '../services/storageService';
import { STORAGE_KEYS, COLUMN_STATUS } from '../constants';

interface UndoAction {
    type: 'delete' | 'update' | 'create';
    task: Task;
    previousState?: Task;
}

interface UseTaskManagementProps {
    activeProjectId: string;
    columns: BoardColumn[];
    addToast: (message: string, type: ToastType) => void;
}

export function useTaskManagement({ activeProjectId, columns, addToast }: UseTaskManagementProps) {
    const [tasks, setTasks] = useState<Task[]>(() =>
        storageService.get(STORAGE_KEYS.TASKS, [] as Task[])
    );

    // Undo stack (max 20 actions)
    const undoStack = useRef<UndoAction[]>([]);
    const MAX_UNDO = 20;

    // Save to storage whenever tasks change
    const saveTasks = useCallback((newTasks: Task[]) => {
        setTasks(newTasks);
        storageService.set(STORAGE_KEYS.TASKS, newTasks);
    }, []);

    // Push to undo stack
    const pushUndo = useCallback((action: UndoAction) => {
        undoStack.current = [action, ...undoStack.current.slice(0, MAX_UNDO - 1)];
    }, []);

    // Undo last action
    const undo = useCallback(() => {
        const action = undoStack.current.shift();
        if (!action) {
            addToast('Nothing to undo', 'info');
            return;
        }

        switch (action.type) {
            case 'delete':
                saveTasks([...tasks, action.task]);
                addToast(`Restored "${action.task.title}"`, 'success');
                break;
            case 'update':
                if (action.previousState) {
                    saveTasks(tasks.map(t => t.id === action.task.id ? action.previousState! : t));
                    addToast('Change undone', 'info');
                }
                break;
            case 'create':
                saveTasks(tasks.filter(t => t.id !== action.task.id));
                addToast('Task creation undone', 'info');
                break;
        }
    }, [tasks, saveTasks, addToast]);

    // Create task
    const createTask = useCallback((taskData: Partial<Task>) => {
        const now = new Date();
        const newTask: Task = {
            id: `task-${Date.now()}`,
            jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
            projectId: activeProjectId,
            title: taskData.title || 'Untitled',
            subtitle: taskData.subtitle || '',
            summary: taskData.summary || '',
            assignee: taskData.assignee || '',
            priority: taskData.priority || 'medium',
            status: taskData.status || columns[0]?.id || COLUMN_STATUS.PENDING,
            createdAt: now,
            updatedAt: now,
            dueDate: taskData.dueDate,
            subtasks: taskData.subtasks || [],
            attachments: taskData.attachments || [],
            customFieldValues: taskData.customFieldValues || {},
            links: taskData.links || [],
            tags: taskData.tags || [],
            timeEstimate: taskData.timeEstimate || 0,
            timeSpent: taskData.timeSpent || 0,
            errorLogs: taskData.errorLogs || [],
        } as Task;

        pushUndo({ type: 'create', task: newTask });
        saveTasks([...tasks, newTask]);
        addToast('Task created successfully', 'success');
        return newTask;
    }, [activeProjectId, columns, tasks, saveTasks, addToast, pushUndo]);

    // Update task
    const updateTask = useCallback((updatedTask: Task) => {
        const previousTask = tasks.find(t => t.id === updatedTask.id);
        const taskWithUpdatedTime = {
            ...updatedTask,
            updatedAt: new Date(),
        };
        if (previousTask) {
            pushUndo({ type: 'update', task: taskWithUpdatedTime, previousState: previousTask });
        }
        saveTasks(tasks.map(t => t.id === updatedTask.id ? taskWithUpdatedTime : t));
    }, [tasks, saveTasks, pushUndo]);

    // Delete task
    const deleteTask = useCallback((taskId: string, skipConfirm = false) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        if (!skipConfirm && !window.confirm('Delete this task? Press Ctrl+Z to undo.')) {
            return;
        }

        pushUndo({ type: 'delete', task });
        saveTasks(tasks.filter(t => t.id !== taskId));
        addToast('Task deleted (Ctrl+Z to undo)', 'info');
    }, [tasks, saveTasks, addToast, pushUndo]);

    // Move task (with dependency checking)
    const moveTask = useCallback((taskId: string, newStatus: string, newPriority?: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        // Dependency blocking check
        if (newStatus !== columns[0]?.id) {
            const blockedLinks = task.links?.filter(l => l.type === 'blocked-by') || [];
            for (const link of blockedLinks) {
                const blocker = tasks.find(t => t.id === link.targetTaskId);
                if (blocker) {
                    const blockerCol = columns.find(c => c.id === blocker.status);
                    if (!blockerCol?.isCompleted && blocker.status !== COLUMN_STATUS.DELIVERED) {
                        addToast(`Cannot start: Blocked by task ${blocker.jobId}`, 'error');
                        return;
                    }
                }
            }
        }

        const previousTask = { ...task };
        const updatedTask = {
            ...task,
            status: newStatus,
            priority: newPriority || task.priority,
            updatedAt: new Date(),
        };

        pushUndo({ type: 'update', task: updatedTask, previousState: previousTask });
        saveTasks(tasks.map(t => t.id === taskId ? updatedTask : t));
    }, [tasks, columns, saveTasks, addToast, pushUndo]);

    // Bulk create tasks (for AI generation)
    const bulkCreateTasks = useCallback((newTasks: Partial<Task>[]) => {
        const now = new Date();
        const createdTasks = newTasks.map(taskData => ({
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            jobId: `AI-${Math.floor(Math.random() * 9000) + 1000}`,
            projectId: activeProjectId,
            title: taskData.title || 'Untitled',
            subtitle: taskData.subtitle || 'AI Generated',
            summary: taskData.summary || '',
            assignee: '',
            priority: taskData.priority || 'medium',
            status: COLUMN_STATUS.PENDING,
            createdAt: now,
            updatedAt: now,
            subtasks: [],
            attachments: [],
            customFieldValues: {},
            links: [],
            tags: [],
            timeEstimate: 0,
            timeSpent: 0,
            errorLogs: [],
        } as Task));

        saveTasks([...tasks, ...createdTasks]);
        addToast(`Generated ${createdTasks.length} tasks`, 'success');
        return createdTasks;
    }, [activeProjectId, tasks, saveTasks, addToast]);

    // Get tasks by project
    const getProjectTasks = useCallback((projectId: string) => {
        return tasks.filter(t => t.projectId === projectId);
    }, [tasks]);

    // Filtered tasks by project
    const currentProjectTasks = useMemo(() => {
        return tasks.filter(t => t.projectId === activeProjectId);
    }, [tasks, activeProjectId]);

    return {
        tasks,
        setTasks: saveTasks,
        createTask,
        updateTask,
        deleteTask,
        moveTask,
        bulkCreateTasks,
        getProjectTasks,
        currentProjectTasks,
        undo,
        canUndo: undoStack.current.length > 0,
    };
}
