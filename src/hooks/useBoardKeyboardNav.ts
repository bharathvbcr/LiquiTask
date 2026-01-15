import React, { useState, useCallback, useEffect } from 'react';
import { useKeybinding } from '../context/KeybindingContext';
import { BoardColumn, Task } from '../../types';

interface UseBoardKeyboardNavOptions {
    columns: BoardColumn[];
    tasks: Task[];
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
    onEditTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    getTasksByContext: (statusId: string, priorityId?: string) => Task[];
    boardGrouping: 'none' | 'priority';
    isEnabled?: boolean;
}

interface UseBoardKeyboardNavReturn {
    focusedColumnIndex: number;
    focusedTaskId: string | null;
    setFocusedColumnIndex: (index: number) => void;
    setFocusedTaskId: (id: string | null) => void;
    handlers: {
        onKeyDown: (e: React.KeyboardEvent) => void;
    };
}

export function useBoardKeyboardNav({
    columns,
    tasks,
    onMoveTask,
    onEditTask,
    onDeleteTask,
    getTasksByContext,
    boardGrouping: _boardGrouping,
    isEnabled = true,
}: UseBoardKeyboardNavOptions): UseBoardKeyboardNavReturn {
    const [focusedColumnIndex, setFocusedColumnIndex] = useState(-1);
    const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
    const { matches } = useKeybinding();

    // Get tasks in focused column
    const getFocusedColumnTasks = useCallback(() => {
        if (focusedColumnIndex < 0 || focusedColumnIndex >= columns.length) return [];
        const column = columns[focusedColumnIndex];
        return getTasksByContext(column.id);
    }, [focusedColumnIndex, columns, getTasksByContext]);

    // Move focus to next/previous column
    const moveColumn = useCallback((direction: 'left' | 'right') => {
        if (columns.length === 0) return;

        const newIndex = direction === 'right'
            ? Math.min(focusedColumnIndex + 1, columns.length - 1)
            : Math.max(focusedColumnIndex - 1, 0);

        setFocusedColumnIndex(newIndex);
        setFocusedTaskId(null); // Clear task focus when changing columns
    }, [focusedColumnIndex, columns.length]);

    // Jump to column by index (1-9)
    const jumpToColumn = useCallback((index: number) => {
        if (index < 1 || index > 9) return;
        const targetIndex = index - 1; // Convert 1-9 to 0-8
        if (targetIndex < columns.length) {
            setFocusedColumnIndex(targetIndex);
            setFocusedTaskId(null);
        }
    }, [columns.length]);

    // Move focus to next/previous task in current column
    const moveTask = useCallback((direction: 'up' | 'down') => {
        const columnTasks = getFocusedColumnTasks();
        if (columnTasks.length === 0) return;

        let currentIndex = -1;
        if (focusedTaskId) {
            currentIndex = columnTasks.findIndex(t => t.id === focusedTaskId);
        }

        let newIndex: number;
        if (currentIndex === -1) {
            newIndex = direction === 'down' ? 0 : columnTasks.length - 1;
        } else {
            newIndex = direction === 'down'
                ? Math.min(currentIndex + 1, columnTasks.length - 1)
                : Math.max(currentIndex - 1, 0);
        }

        setFocusedTaskId(columnTasks[newIndex].id);
    }, [focusedTaskId, getFocusedColumnTasks]);

    // Move task to next/previous column
    const moveTaskToColumn = useCallback((direction: 'next' | 'prev') => {
        if (!focusedTaskId) return;

        const task = tasks.find(t => t.id === focusedTaskId);
        if (!task) return;

        const currentColumnIndex = columns.findIndex(c => c.id === task.status);
        if (currentColumnIndex === -1) return;

        const targetIndex = direction === 'next'
            ? Math.min(currentColumnIndex + 1, columns.length - 1)
            : Math.max(currentColumnIndex - 1, 0);

        const targetColumn = columns[targetIndex];
        onMoveTask(focusedTaskId, targetColumn.id);

        // Update focus to new column
        setFocusedColumnIndex(targetIndex);
    }, [focusedTaskId, tasks, columns, onMoveTask]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!isEnabled) return;

        // Don't handle if user is typing in an input
        const target = e.target as HTMLElement;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
            return;
        }

        // Horizontal column navigation
        if (matches('nav:right', e)) {
            e.preventDefault();
            moveColumn('right');
        } else if (matches('nav:left', e)) {
            e.preventDefault();
            moveColumn('left');
        }
        // Column jumping (1-9)
        else if (matches('nav:column-1', e)) {
            e.preventDefault();
            jumpToColumn(1);
        } else if (matches('nav:column-2', e)) {
            e.preventDefault();
            jumpToColumn(2);
        } else if (matches('nav:column-3', e)) {
            e.preventDefault();
            jumpToColumn(3);
        } else if (matches('nav:column-4', e)) {
            e.preventDefault();
            jumpToColumn(4);
        } else if (matches('nav:column-5', e)) {
            e.preventDefault();
            jumpToColumn(5);
        } else if (matches('nav:column-6', e)) {
            e.preventDefault();
            jumpToColumn(6);
        } else if (matches('nav:column-7', e)) {
            e.preventDefault();
            jumpToColumn(7);
        } else if (matches('nav:column-8', e)) {
            e.preventDefault();
            jumpToColumn(8);
        } else if (matches('nav:column-9', e)) {
            e.preventDefault();
            jumpToColumn(9);
        }
        // Vertical task navigation within column
        else if (matches('nav:down', e)) {
            e.preventDefault();
            moveTask('down');
        } else if (matches('nav:up', e)) {
            e.preventDefault();
            moveTask('up');
        }
        // Task actions
        else if (matches('task:edit', e) && focusedTaskId) {
            e.preventDefault();
            const task = tasks.find(t => t.id === focusedTaskId);
            if (task) onEditTask(task);
        } else if (matches('task:delete', e) && focusedTaskId && e.shiftKey) {
            e.preventDefault();
            onDeleteTask(focusedTaskId);
        } else if (matches('task:move-next', e) && focusedTaskId) {
            e.preventDefault();
            moveTaskToColumn('next');
        } else if (matches('task:move-prev', e) && focusedTaskId) {
            e.preventDefault();
            moveTaskToColumn('prev');
        }
        // Select/Open task
        else if (matches('nav:select', e) && focusedTaskId) {
            e.preventDefault();
            const task = tasks.find(t => t.id === focusedTaskId);
            if (task) onEditTask(task);
        }
        // Clear focus
        else if (matches('nav:back', e)) {
            e.preventDefault();
            setFocusedTaskId(null);
        }
    }, [
        isEnabled,
        focusedTaskId,
        tasks,
        matches,
        moveColumn,
        jumpToColumn,
        moveTask,
        moveTaskToColumn,
        onEditTask,
        onDeleteTask,
    ]);

    // Reset focus when columns change
    useEffect(() => {
        if (focusedColumnIndex >= 0 && focusedColumnIndex >= columns.length) {
            setFocusedColumnIndex(Math.max(0, columns.length - 1));
        }
    }, [focusedColumnIndex, columns.length]);

    // Reset task focus when tasks change
    useEffect(() => {
        if (focusedTaskId && !tasks.find(t => t.id === focusedTaskId)) {
            setFocusedTaskId(null);
        }
    }, [focusedTaskId, tasks]);

    return {
        focusedColumnIndex,
        focusedTaskId,
        setFocusedColumnIndex,
        setFocusedTaskId,
        handlers: {
            onKeyDown: handleKeyDown,
        },
    };
}
