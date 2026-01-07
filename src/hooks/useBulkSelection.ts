import { useState, useCallback, useMemo } from 'react';

interface UseBulkSelectionOptions<T extends { id: string }> {
    items: T[];
    onSelectionChange?: (selectedIds: string[]) => void;
}

interface UseBulkSelectionReturn {
    selectedIds: Set<string>;
    isSelected: (id: string) => boolean;
    toggleSelect: (id: string, shiftKey?: boolean) => void;
    selectAll: () => void;
    selectNone: () => void;
    selectByFilter: (filter: (id: string) => boolean) => void;
    selectedCount: number;
    isAllSelected: boolean;
    isSomeSelected: boolean;
}

export function useBulkSelection<T extends { id: string }>({
    items,
    onSelectionChange
}: UseBulkSelectionOptions<T>): UseBulkSelectionReturn {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    const itemIds = useMemo(() => items.map(item => item.id), [items]);

    const updateSelection = useCallback((newSelection: Set<string>) => {
        setSelectedIds(newSelection);
        onSelectionChange?.(Array.from(newSelection));
    }, [onSelectionChange]);

    const isSelected = useCallback((id: string) => {
        return selectedIds.has(id);
    }, [selectedIds]);

    const toggleSelect = useCallback((id: string, shiftKey = false) => {
        const newSelection = new Set(selectedIds);

        if (shiftKey && lastSelectedId && lastSelectedId !== id) {
            // Shift+Click: Select range
            const lastIndex = itemIds.indexOf(lastSelectedId);
            const currentIndex = itemIds.indexOf(id);

            if (lastIndex !== -1 && currentIndex !== -1) {
                const [start, end] = lastIndex < currentIndex
                    ? [lastIndex, currentIndex]
                    : [currentIndex, lastIndex];

                for (let i = start; i <= end; i++) {
                    newSelection.add(itemIds[i]);
                }
            }
        } else {
            // Regular click: Toggle single item
            if (newSelection.has(id)) {
                newSelection.delete(id);
            } else {
                newSelection.add(id);
            }
        }

        setLastSelectedId(id);
        updateSelection(newSelection);
    }, [selectedIds, lastSelectedId, itemIds, updateSelection]);

    const selectAll = useCallback(() => {
        updateSelection(new Set(itemIds));
    }, [itemIds, updateSelection]);

    const selectNone = useCallback(() => {
        updateSelection(new Set());
        setLastSelectedId(null);
    }, [updateSelection]);

    const selectByFilter = useCallback((filter: (id: string) => boolean) => {
        const filtered = itemIds.filter(filter);
        updateSelection(new Set(filtered));
    }, [itemIds, updateSelection]);

    const selectedCount = selectedIds.size;
    const isAllSelected = selectedCount === itemIds.length && itemIds.length > 0;
    const isSomeSelected = selectedCount > 0;

    return {
        selectedIds,
        isSelected,
        toggleSelect,
        selectAll,
        selectNone,
        selectByFilter,
        selectedCount,
        isAllSelected,
        isSomeSelected,
    };
}
