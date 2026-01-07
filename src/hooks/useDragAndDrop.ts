import { useState, useCallback } from 'react';

interface DragOverInfo {
    colId: string;
    rowId?: string;
}

interface UseDragAndDropProps {
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string) => void;
    onReorderColumns: (draggedId: string, targetId: string) => void;
}

export function useDragAndDrop({ onMoveTask, onReorderColumns }: UseDragAndDropProps) {
    const [dragOverInfo, setDragOverInfo] = useState<DragOverInfo | null>(null);
    const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);

    // Task drag handlers
    const handleDragOver = useCallback((e: React.DragEvent, colId: string, rowId?: string) => {
        e.preventDefault();
    }, []);

    const handleDragEnter = useCallback((colId: string, rowId?: string) => {
        setDragOverInfo({ colId, rowId });
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, statusId: string, priorityId?: string) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('taskId');
        if (taskId) {
            onMoveTask(taskId, statusId, priorityId);
        }
        setDragOverInfo(null);
    }, [onMoveTask]);

    const handleDragLeave = useCallback(() => {
        // Optional: Can add delay to prevent flicker
    }, []);

    // Column drag handlers
    const handleColumnDragStart = useCallback((e: React.DragEvent, colId: string) => {
        setDraggedColumnId(colId);
        e.dataTransfer.setData('columnId', colId);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleColumnDrop = useCallback((e: React.DragEvent, targetColId: string) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('columnId');
        if (draggedId && draggedId !== targetColId) {
            onReorderColumns(draggedId, targetColId);
        }
        setDraggedColumnId(null);
    }, [onReorderColumns]);

    const handleColumnDragEnd = useCallback(() => {
        setDraggedColumnId(null);
    }, []);

    return {
        dragOverInfo,
        draggedColumnId,
        // Task handlers
        handleDragOver,
        handleDragEnter,
        handleDrop,
        handleDragLeave,
        // Column handlers
        handleColumnDragStart,
        handleColumnDrop,
        handleColumnDragEnd,
        // Utilities
        isDraggingColumn: draggedColumnId !== null,
        isOverColumn: (colId: string, rowId?: string) =>
            dragOverInfo?.colId === colId && dragOverInfo?.rowId === rowId,
    };
}
