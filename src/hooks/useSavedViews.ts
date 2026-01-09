import { useState, useCallback, useEffect } from 'react';
import { FilterState } from '../../types';

export interface SavedView {
    id: string;
    name: string;
    filters: FilterState;
    grouping: 'none' | 'priority';
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    createdAt: Date;
    isDefault?: boolean;
}

const STORAGE_KEY = 'liquitask_saved_views';
const MAX_VIEWS = 20;

export function useSavedViews() {
    const [views, setViews] = useState<SavedView[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.map((view: SavedView) => ({
                    ...view,
                    createdAt: new Date(view.createdAt),
                }));
            }
        } catch (e) {
            console.error('Failed to load saved views:', e);
        }
        return getDefaultViews();
    });

    const [activeViewId, setActiveViewId] = useState<string | null>(null);

    // Persist to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
        } catch (e) {
            console.error('Failed to save views:', e);
        }
    }, [views]);

    // Create a new view
    const createView = useCallback((
        name: string,
        filters: FilterState,
        grouping: 'none' | 'priority' = 'none'
    ): SavedView | null => {
        if (views.length >= MAX_VIEWS) {
            console.warn('Maximum number of saved views reached');
            return null;
        }

        const newView: SavedView = {
            id: `view-${Date.now()}`,
            name: name.trim(),
            filters,
            grouping,
            createdAt: new Date(),
        };

        setViews(prev => [...prev, newView]);
        return newView;
    }, [views.length]);

    // Update an existing view
    const updateView = useCallback((id: string, updates: Partial<Omit<SavedView, 'id' | 'createdAt'>>) => {
        setViews(prev => prev.map(view =>
            view.id === id ? { ...view, ...updates } : view
        ));
    }, []);

    // Delete a view
    const deleteView = useCallback((id: string) => {
        setViews(prev => prev.filter(view => view.id !== id));
        if (activeViewId === id) {
            setActiveViewId(null);
        }
    }, [activeViewId]);

    // Apply a view's filters
    const applyView = useCallback((id: string): SavedView | undefined => {
        const view = views.find(v => v.id === id);
        if (view) {
            setActiveViewId(id);
        }
        return view;
    }, [views]);

    // Clear active view
    const clearActiveView = useCallback(() => {
        setActiveViewId(null);
    }, []);

    // Set a view as default
    const setDefaultView = useCallback((id: string | null) => {
        setViews(prev => prev.map(view => ({
            ...view,
            isDefault: view.id === id,
        })));
    }, []);

    // Get default view
    const getDefaultView = useCallback((): SavedView | undefined => {
        return views.find(v => v.isDefault);
    }, [views]);

    // Rename a view
    const renameView = useCallback((id: string, newName: string) => {
        updateView(id, { name: newName.trim() });
    }, [updateView]);

    // Duplicate a view
    const duplicateView = useCallback((id: string): SavedView | null => {
        const original = views.find(v => v.id === id);
        if (!original || views.length >= MAX_VIEWS) return null;

        return createView(
            `${original.name} (Copy)`,
            original.filters,
            original.grouping
        );
    }, [views, createView]);

    return {
        views,
        activeViewId,
        activeView: views.find(v => v.id === activeViewId),
        createView,
        updateView,
        deleteView,
        applyView,
        clearActiveView,
        setDefaultView,
        getDefaultView,
        renameView,
        duplicateView,
    };
}

// Default views to start with
function getDefaultViews(): SavedView[] {
    return [
        {
            id: 'view-my-tasks',
            name: 'My Tasks',
            filters: {
                assignee: '',
                dateRange: null,
                startDate: '',
                endDate: '',
                tags: '',
            },
            grouping: 'none',
            createdAt: new Date(),
            isDefault: true,
        },
        {
            id: 'view-due-this-week',
            name: 'Due This Week',
            filters: {
                assignee: '',
                dateRange: 'due',
                startDate: getWeekStart(),
                endDate: getWeekEnd(),
                tags: '',
            },
            grouping: 'priority',
            createdAt: new Date(),
        },
        {
            id: 'view-high-priority',
            name: 'High Priority',
            filters: {
                assignee: '',
                dateRange: null,
                startDate: '',
                endDate: '',
                tags: '',
            },
            grouping: 'priority',
            createdAt: new Date(),
        },
    ];
}

// Helper to get current week's start date
function getWeekStart(): string {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split('T')[0];
}

// Helper to get current week's end date
function getWeekEnd(): string {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? 0 : 7);
    const sunday = new Date(now.setDate(diff));
    return sunday.toISOString().split('T')[0];
}

export default useSavedViews;
