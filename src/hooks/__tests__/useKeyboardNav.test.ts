import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardNav } from '../useKeyboardNav';
import * as KeybindingContext from '../../context/KeybindingContext';

// Mock useKeybinding hook
vi.mock('../../context/KeybindingContext', () => ({
    useKeybinding: vi.fn()
}));

describe('useKeyboardNav', () => {
    const mockItems = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const mockMatches = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (KeybindingContext.useKeybinding as any).mockReturnValue({
            matches: mockMatches
        });
    });

    it('should initialize with no focusedId', () => {
        const { result } = renderHook(() => useKeyboardNav({ items: mockItems }));
        expect(result.current.focusedId).toBeNull();
    });

    it('should move focus down on nav:down', () => {
        mockMatches.mockImplementation((action) => action === 'nav:down');
        const { result } = renderHook(() => useKeyboardNav({ items: mockItems }));

        act(() => {
            result.current.handlers.onKeyDown({
                key: 'ArrowDown',
                preventDefault: vi.fn(),
                target: document.createElement('div')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        expect(result.current.focusedId).toBe('1');

        act(() => {
            result.current.handlers.onKeyDown({
                key: 'ArrowDown',
                preventDefault: vi.fn(),
                target: document.createElement('div')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        expect(result.current.focusedId).toBe('2');
    });

    it('should move focus up on nav:up', () => {
        mockMatches.mockImplementation((action) => action === 'nav:up');
        const { result } = renderHook(() => useKeyboardNav({ items: mockItems }));

        // Start at last item
        act(() => {
            result.current.setFocusedId('3');
        });

        act(() => {
            result.current.handlers.onKeyDown({
                key: 'ArrowUp',
                preventDefault: vi.fn(),
                target: document.createElement('div')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        expect(result.current.focusedId).toBe('2');
    });

    it('should call onOpen on nav:select', () => {
        const onOpen = vi.fn();
        mockMatches.mockImplementation((action) => action === 'nav:select');
        const { result } = renderHook(() => useKeyboardNav({ items: mockItems, onOpen }));

        act(() => {
            result.current.setFocusedId('1');
        });

        act(() => {
            result.current.handlers.onKeyDown({
                key: 'Enter',
                preventDefault: vi.fn(),
                target: document.createElement('div')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        expect(onOpen).toHaveBeenCalledWith('1');
    });

    it('should call onDelete on task:delete with shift key', () => {
        const onDelete = vi.fn();
        mockMatches.mockImplementation((action) => action === 'task:delete');
        const { result } = renderHook(() => useKeyboardNav({ items: mockItems, onDelete }));

        act(() => {
            result.current.setFocusedId('2');
        });

        act(() => {
            result.current.handlers.onKeyDown({
                key: 'Delete',
                shiftKey: true,
                preventDefault: vi.fn(),
                target: document.createElement('div')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        expect(onDelete).toHaveBeenCalledWith('2');
    });

    it('should not trigger shortcuts when typing in an input', () => {
        mockMatches.mockImplementation(() => true);
        const { result } = renderHook(() => useKeyboardNav({ items: mockItems }));

        const input = document.createElement('input');
        act(() => {
            result.current.handlers.onKeyDown({
                key: 'j',
                preventDefault: vi.fn(),
                target: input
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        expect(result.current.focusedId).toBeNull();
    });

    it('should reset focus if focused item is removed', () => {
        const { result, rerender } = renderHook(
            ({ items }) => useKeyboardNav({ items }),
            { initialProps: { items: mockItems } }
        );

        act(() => {
            result.current.setFocusedId('3');
        });

        rerender({ items: [{ id: '1' }, { id: '2' }] });

        expect(result.current.focusedId).toBeNull();
    });
});
