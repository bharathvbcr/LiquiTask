import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkSelection } from '../useBulkSelection';

interface TestItem {
    id: string;
    name: string;
}

describe('useBulkSelection', () => {
    const mockItems: TestItem[] = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' },
        { id: '3', name: 'Item 3' },
        { id: '4', name: 'Item 4' },
    ];

    describe('initialization', () => {
        it('should initialize with no selections', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            expect(result.current.selectedIds.size).toBe(0);
            expect(result.current.selectedCount).toBe(0);
            expect(result.current.isAllSelected).toBe(false);
            expect(result.current.isSomeSelected).toBe(false);
        });
    });

    describe('isSelected', () => {
        it('should return false for unselected items', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            expect(result.current.isSelected('1')).toBe(false);
        });

        it('should return true for selected items', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.isSelected('1')).toBe(true);
            expect(result.current.isSelected('2')).toBe(false);
        });
    });

    describe('toggleSelect', () => {
        it('should select an item', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.isSelected('1')).toBe(true);
            expect(result.current.selectedCount).toBe(1);
        });

        it('should deselect an item', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.isSelected('1')).toBe(true);

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.isSelected('1')).toBe(false);
            expect(result.current.selectedCount).toBe(0);
        });

        it('should select range with shift+click', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            // Select first item
            act(() => {
                result.current.toggleSelect('1');
            });

            // Shift+click on third item
            act(() => {
                result.current.toggleSelect('3', true);
            });

            expect(result.current.isSelected('1')).toBe(true);
            expect(result.current.isSelected('2')).toBe(true);
            expect(result.current.isSelected('3')).toBe(true);
            expect(result.current.isSelected('4')).toBe(false);
            expect(result.current.selectedCount).toBe(3);
        });

        it('should select range backwards with shift+click', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            // Select third item
            act(() => {
                result.current.toggleSelect('3');
            });

            // Shift+click on first item
            act(() => {
                result.current.toggleSelect('1', true);
            });

            expect(result.current.isSelected('1')).toBe(true);
            expect(result.current.isSelected('2')).toBe(true);
            expect(result.current.isSelected('3')).toBe(true);
            expect(result.current.selectedCount).toBe(3);
        });

        it('should handle shift+click without previous selection', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('2', true);
            });

            // Should just select the clicked item
            expect(result.current.isSelected('2')).toBe(true);
            expect(result.current.selectedCount).toBe(1);
        });
    });

    describe('selectAll', () => {
        it('should select all items', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.selectAll();
            });

            expect(result.current.selectedCount).toBe(4);
            expect(result.current.isAllSelected).toBe(true);
            expect(result.current.isSomeSelected).toBe(true);
        });
    });

    describe('selectNone', () => {
        it('should deselect all items', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.selectAll();
            });

            expect(result.current.selectedCount).toBe(4);

            act(() => {
                result.current.selectNone();
            });

            expect(result.current.selectedCount).toBe(0);
            expect(result.current.isAllSelected).toBe(false);
            expect(result.current.isSomeSelected).toBe(false);
        });
    });

    describe('selectByFilter', () => {
        it('should select items matching filter', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.selectByFilter((id) => id === '1' || id === '3');
            });

            expect(result.current.isSelected('1')).toBe(true);
            expect(result.current.isSelected('2')).toBe(false);
            expect(result.current.isSelected('3')).toBe(true);
            expect(result.current.isSelected('4')).toBe(false);
            expect(result.current.selectedCount).toBe(2);
        });
    });

    describe('selectedCount', () => {
        it('should return correct count', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.selectedCount).toBe(1);

            act(() => {
                result.current.toggleSelect('2');
            });

            expect(result.current.selectedCount).toBe(2);
        });
    });

    describe('isAllSelected', () => {
        it('should return true when all items selected', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.selectAll();
            });

            expect(result.current.isAllSelected).toBe(true);
        });

        it('should return false when not all items selected', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.isAllSelected).toBe(false);
        });

        it('should return false for empty items array', () => {
            const { result } = renderHook(() => useBulkSelection({ items: [] }));

            expect(result.current.isAllSelected).toBe(false);
        });
    });

    describe('isSomeSelected', () => {
        it('should return true when some items selected', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(result.current.isSomeSelected).toBe(true);
        });

        it('should return false when no items selected', () => {
            const { result } = renderHook(() => useBulkSelection({ items: mockItems }));

            expect(result.current.isSomeSelected).toBe(false);
        });
    });

    describe('onSelectionChange callback', () => {
        it('should call callback when selection changes', () => {
            const onSelectionChange = vi.fn();
            const { result } = renderHook(() =>
                useBulkSelection({ items: mockItems, onSelectionChange })
            );

            act(() => {
                result.current.toggleSelect('1');
            });

            expect(onSelectionChange).toHaveBeenCalledWith(['1']);

            act(() => {
                result.current.toggleSelect('2');
            });

            expect(onSelectionChange).toHaveBeenCalledWith(['1', '2']);
        });

        it('should call callback with empty array when all deselected', () => {
            const onSelectionChange = vi.fn();
            const { result } = renderHook(() =>
                useBulkSelection({ items: mockItems, onSelectionChange })
            );

            act(() => {
                result.current.selectAll();
            });

            act(() => {
                result.current.selectNone();
            });

            expect(onSelectionChange).toHaveBeenCalledWith([]);
        });
    });

    describe('dynamic items', () => {
        it('should handle items array changes', () => {
            const { result, rerender } = renderHook(
                ({ items }) => useBulkSelection({ items }),
                { initialProps: { items: mockItems } }
            );

            act(() => {
                result.current.selectAll();
            });

            expect(result.current.selectedCount).toBe(4);

            // Change items - selectedIds still contains old IDs
            rerender({ items: [{ id: '1', name: 'Item 1' }] });

            // The hook doesn't automatically filter invalid selections
            // selectedCount will still be 4 (old selections), but isAllSelected checks against current items
            // Since only 1 item exists now and we have 4 selected (including invalid ones),
            // isAllSelected will be false (4 !== 1)
            expect(result.current.isAllSelected).toBe(false);
            // selectedCount includes invalid selections, so it's still 4
            expect(result.current.selectedCount).toBe(4);
            
            // Clear all selections first
            act(() => {
                result.current.selectNone();
            });
            expect(result.current.selectedCount).toBe(0);
            
            // Then select the new item
            act(() => {
                result.current.toggleSelect('1');
            });
            expect(result.current.selectedCount).toBe(1);
            expect(result.current.isAllSelected).toBe(true);
        });
    });
});

