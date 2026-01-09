import React, { useState, useEffect, useCallback } from 'react';

interface UseKeyboardNavOptions {
    items: { id: string }[];
    isEnabled?: boolean;
    onSelect?: (id: string) => void;
    onOpen?: (id: string) => void;
    onDelete?: (id: string) => void;
    containerRef?: React.RefObject<HTMLElement>;
}

interface UseKeyboardNavReturn {
    focusedId: string | null;
    setFocusedId: (id: string | null) => void;
    isFocused: (id: string) => boolean;
    handlers: {
        onKeyDown: (e: React.KeyboardEvent) => void;
    };
}

export function useKeyboardNav({
    items,
    isEnabled = true,
    onSelect,
    onOpen,
    onDelete,
    containerRef,
}: UseKeyboardNavOptions): UseKeyboardNavReturn {
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const itemIds = items.map(item => item.id);

    const focusedIndex = focusedId ? itemIds.indexOf(focusedId) : -1;

    const moveFocus = useCallback((direction: 'up' | 'down') => {
        if (itemIds.length === 0) return;

        let newIndex: number;
        if (focusedIndex === -1) {
            newIndex = direction === 'down' ? 0 : itemIds.length - 1;
        } else {
            newIndex = direction === 'down'
                ? Math.min(focusedIndex + 1, itemIds.length - 1)
                : Math.max(focusedIndex - 1, 0);
        }

        setFocusedId(itemIds[newIndex]);
    }, [focusedIndex, itemIds]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!isEnabled) return;

        // Don't handle if user is typing in an input
        const target = e.target as HTMLElement;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'j':
            case 'arrowdown':
                e.preventDefault();
                moveFocus('down');
                break;
            case 'k':
            case 'arrowup':
                e.preventDefault();
                moveFocus('up');
                break;
            case 'enter':
            case ' ':
                if (focusedId) {
                    e.preventDefault();
                    onOpen?.(focusedId);
                }
                break;
            case 'x':
                if (focusedId) {
                    e.preventDefault();
                    onSelect?.(focusedId);
                }
                break;
            case 'delete':
            case 'backspace':
                if (focusedId && e.shiftKey) {
                    e.preventDefault();
                    onDelete?.(focusedId);
                }
                break;
            case 'escape':
                e.preventDefault();
                setFocusedId(null);
                break;
            case 'home':
                e.preventDefault();
                if (itemIds.length > 0) {
                    setFocusedId(itemIds[0]);
                }
                break;
            case 'end':
                e.preventDefault();
                if (itemIds.length > 0) {
                    setFocusedId(itemIds[itemIds.length - 1]);
                }
                break;
        }
    }, [isEnabled, focusedId, moveFocus, onOpen, onSelect, onDelete, itemIds]);

    // Reset focus when items change
    useEffect(() => {
        if (focusedId && !itemIds.includes(focusedId)) {
            setFocusedId(null);
        }
    }, [focusedId, itemIds]);

    // Focus container when focused item changes
    useEffect(() => {
        if (focusedId && containerRef?.current) {
            containerRef.current.focus();
        }
    }, [focusedId, containerRef]);

    const isFocused = useCallback((id: string) => focusedId === id, [focusedId]);

    return {
        focusedId,
        setFocusedId,
        isFocused,
        handlers: {
            onKeyDown: handleKeyDown,
        },
    };
}

// Keyboard shortcut descriptions
export const KEYBOARD_SHORTCUTS = [
    { key: 'J / ↓', description: 'Move down' },
    { key: 'K / ↑', description: 'Move up' },
    { key: 'Enter', description: 'Open task' },
    { key: 'X', description: 'Select task' },
    { key: 'Shift+Delete', description: 'Delete task' },
    { key: 'Esc', description: 'Clear focus' },
    { key: 'C', description: 'Create new task' },
    { key: 'Cmd/Ctrl+K', description: 'Focus search' },
    { key: 'Cmd/Ctrl+B', description: 'Toggle sidebar' },
    { key: '?', description: 'Show shortcuts' },
] as const;
