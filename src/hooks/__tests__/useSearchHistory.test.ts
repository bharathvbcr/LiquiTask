import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchHistory } from '../useSearchHistory';

describe('useSearchHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    });

    it('should initialize with empty history', () => {
        const { result } = renderHook(() => useSearchHistory());
        expect(result.current.history).toEqual([]);
    });

    it('should add a search to history', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('test query');
        });

        expect(result.current.history).toHaveLength(1);
        expect(result.current.history[0].query).toBe('test query');
        expect(result.current.history[0].isSaved).toBe(false);
    });

    it('should not add empty queries', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('');
            result.current.addToHistory('   ');
        });

        expect(result.current.history).toHaveLength(0);
    });

    it('should toggle saved status', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('test query');
        });

        const id = result.current.history[0].id;

        act(() => {
            result.current.toggleSaved(id);
        });

        expect(result.current.history[0].isSaved).toBe(true);

        act(() => {
            result.current.toggleSaved(id);
        });

        expect(result.current.history[0].isSaved).toBe(false);
    });

    it('should remove from history', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('query 1');
            result.current.addToHistory('query 2');
        });

        expect(result.current.history).toHaveLength(2);

        const id = result.current.history[0].id;
        act(() => {
            result.current.removeFromHistory(id);
        });

        expect(result.current.history).toHaveLength(1);
    });

    it('should clear history but keep saved items', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('query 1');
            result.current.addToHistory('query 2');
        });

        const id = result.current.history[0].id;
        act(() => {
            result.current.toggleSaved(id);
        });

        act(() => {
            result.current.clearHistory(true);
        });

        expect(result.current.history).toHaveLength(1);
        expect(result.current.history[0].isSaved).toBe(true);
    });

    it('should get recent searches', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('query 1');
            result.current.addToHistory('query 2');
        });

        const recent = result.current.getRecentSearches();
        expect(recent).toHaveLength(2);
        expect(recent[0].query).toBe('query 2');
    });

    it('should get saved searches', () => {
        const { result } = renderHook(() => useSearchHistory());

        act(() => {
            result.current.addToHistory('query 1');
            result.current.addToHistory('query 2');
        });

        const id = result.current.history[1].id;
        act(() => {
            result.current.toggleSaved(id);
        });

        const saved = result.current.getSavedSearches();
        expect(saved).toHaveLength(1);
        expect(saved[0].query).toBe('query 1');
    });
});
