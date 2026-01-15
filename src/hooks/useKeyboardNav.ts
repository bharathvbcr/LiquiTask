import React, { useState, useEffect, useCallback } from 'react';
import { useKeybinding } from '../context/KeybindingContext';

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
    const { matches } = useKeybinding();
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

        if (matches('nav:down', e)) {
            e.preventDefault();
            moveFocus('down');
        } else if (matches('nav:up', e)) {
            e.preventDefault();
            moveFocus('up');
        } else if (matches('nav:select', e)) {
            if (focusedId) {
                e.preventDefault();
                onOpen?.(focusedId);
            }
        } else if (e.key === 'x') { // Keep selection hardcoded or add 'nav:mark' to bindings
             if (focusedId) {
                e.preventDefault();
                onSelect?.(focusedId);
            }
        } else if (matches('task:delete', e)) {
             if (focusedId && e.shiftKey) { // Keep Shift requirement for safety?
                e.preventDefault();
                onDelete?.(focusedId);
            }
        } else if (matches('nav:back', e)) {
            e.preventDefault();
            setFocusedId(null);
        } else if (e.key === 'Home') {
             e.preventDefault();
             if (itemIds.length > 0) setFocusedId(itemIds[0]);
        } else if (e.key === 'End') {
             e.preventDefault();
             if (itemIds.length > 0) setFocusedId(itemIds[itemIds.length - 1]);
        }
    }, [isEnabled, focusedId, moveFocus, onOpen, onSelect, onDelete, itemIds, matches]);

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

// Deprecated: Use KeybindingContext to get current shortcuts
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
