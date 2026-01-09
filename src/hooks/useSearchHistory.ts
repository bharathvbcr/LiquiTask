import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants';

export interface SearchHistoryItem {
    id: string;
    query: string;
    timestamp: Date;
    isSaved: boolean;
}

const MAX_HISTORY = 20;
const MAX_SAVED = 10;

export function useSearchHistory() {
    const [history, setHistory] = useState<SearchHistoryItem[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.SEARCH_HISTORY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.map((item: SearchHistoryItem) => ({
                    ...item,
                    timestamp: new Date(item.timestamp),
                }));
            }
        } catch (e) {
            console.error('Failed to load search history:', e);
        }
        return [];
    });

    // Persist to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(history));
        } catch (e) {
            console.error('Failed to save search history:', e);
        }
    }, [history]);

    const addToHistory = useCallback((query: string) => {
        if (!query.trim()) return;

        setHistory(prev => {
            // Remove duplicate queries
            const filtered = prev.filter(item => item.query.toLowerCase() !== query.toLowerCase());

            const newItem: SearchHistoryItem = {
                id: `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                query: query.trim(),
                timestamp: new Date(),
                isSaved: false,
            };

            // Keep saved items + limited recent items
            const savedItems = filtered.filter(item => item.isSaved).slice(0, MAX_SAVED);
            const recentItems = filtered.filter(item => !item.isSaved).slice(0, MAX_HISTORY - savedItems.length - 1);

            return [newItem, ...savedItems, ...recentItems];
        });
    }, []);

    const toggleSaved = useCallback((id: string) => {
        setHistory(prev => prev.map(item => {
            if (item.id === id) {
                // Check if we're at the saved limit
                const savedCount = prev.filter(i => i.isSaved && i.id !== id).length;
                if (!item.isSaved && savedCount >= MAX_SAVED) {
                    return item; // Don't allow more saved items
                }
                return { ...item, isSaved: !item.isSaved };
            }
            return item;
        }));
    }, []);

    const removeFromHistory = useCallback((id: string) => {
        setHistory(prev => prev.filter(item => item.id !== id));
    }, []);

    const clearHistory = useCallback((keepSaved = true) => {
        setHistory(prev => keepSaved ? prev.filter(item => item.isSaved) : []);
    }, []);

    const getRecentSearches = useCallback(() => {
        return history.filter(item => !item.isSaved).slice(0, 5);
    }, [history]);

    const getSavedSearches = useCallback(() => {
        return history.filter(item => item.isSaved);
    }, [history]);

    return {
        history,
        addToHistory,
        toggleSaved,
        removeFromHistory,
        clearHistory,
        getRecentSearches,
        getSavedSearches,
    };
}

export default useSearchHistory;
