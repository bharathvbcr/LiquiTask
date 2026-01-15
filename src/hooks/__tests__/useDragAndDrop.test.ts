import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragAndDrop } from '../useDragAndDrop';

describe('useDragAndDrop', () => {
    const mockOnMoveTask = vi.fn();
    const mockOnReorderColumns = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with correct default state', () => {
        const { result } = renderHook(() => useDragAndDrop({
            onMoveTask: mockOnMoveTask,
            onReorderColumns: mockOnReorderColumns
        }));

        expect(result.current.dragOverInfo).toBeNull();
        expect(result.current.draggedColumnId).toBeNull();
        expect(result.current.isDraggingColumn).toBe(false);
    });

    it('should handle drag enter update state', () => {
        const { result } = renderHook(() => useDragAndDrop({
            onMoveTask: mockOnMoveTask,
            onReorderColumns: mockOnReorderColumns
        }));

        act(() => {
            result.current.handleDragEnter('col-1');
        });

        expect(result.current.dragOverInfo).toEqual({ colId: 'col-1', rowId: undefined });
    });

    it('should handle column drag start', () => {
        const { result } = renderHook(() => useDragAndDrop({
            onMoveTask: mockOnMoveTask,
            onReorderColumns: mockOnReorderColumns
        }));

        const mockEvent = {
            dataTransfer: {
                setData: vi.fn(),
                effectAllowed: ''
            }
        } as unknown as React.DragEvent;

        act(() => {
            result.current.handleColumnDragStart(mockEvent, 'col-1');
        });

        expect(result.current.draggedColumnId).toBe('col-1');
        expect(result.current.isDraggingColumn).toBe(true);
        expect(mockEvent.dataTransfer.setData).toHaveBeenCalledWith('columnId', 'col-1');
    });

    it('should handle column drop', () => {
        const { result } = renderHook(() => useDragAndDrop({
            onMoveTask: mockOnMoveTask,
            onReorderColumns: mockOnReorderColumns
        }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: vi.fn().mockReturnValue('col-1')
            }
        } as unknown as React.DragEvent;

        act(() => {
            // First start drag needed? Hook state is local but handlers depend on event data
            // Drop logic uses event dataTransfer, so we don't strictly need to set state first for this test,
            // but in real app state would correspond.
            result.current.handleColumnDrop(mockEvent, 'col-2');
        });

        expect(mockOnReorderColumns).toHaveBeenCalledWith('col-1', 'col-2');
        expect(result.current.draggedColumnId).toBeNull();
    });

    it('should handle task drop', () => {
        const { result } = renderHook(() => useDragAndDrop({
            onMoveTask: mockOnMoveTask,
            onReorderColumns: mockOnReorderColumns
        }));

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                getData: vi.fn().mockReturnValue('task-1')
            }
        } as unknown as React.DragEvent;

        act(() => {
            result.current.handleDrop(mockEvent, 'status-done', 'priority-high');
        });

        expect(mockOnMoveTask).toHaveBeenCalledWith('task-1', 'status-done', 'priority-high');
        expect(result.current.dragOverInfo).toBeNull();
    });
});
