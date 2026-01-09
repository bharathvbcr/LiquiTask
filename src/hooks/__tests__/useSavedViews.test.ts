import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedViews } from '../useSavedViews';
import { FilterState } from '../../../types';

// Mock localStorage
const localStorageMock = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
        localStorageMock.store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
        delete localStorageMock.store[key];
    }),
    clear: vi.fn(() => {
        localStorageMock.store = {};
    }),
    length: 0,
    key: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
});

describe('useSavedViews', () => {
    beforeEach(() => {
        localStorageMock.store = {};
        localStorageMock.getItem.mockClear();
        localStorageMock.setItem.mockClear();
        vi.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with default views', () => {
            const { result } = renderHook(() => useSavedViews());

            expect(result.current.views.length).toBeGreaterThan(0);
            expect(result.current.views.some(v => v.name === 'My Tasks')).toBe(true);
        });

        it('should load views from localStorage', () => {
            const savedViews = [
                {
                    id: 'view-1',
                    name: 'Custom View',
                    filters: {
                        assignee: 'John',
                        dateRange: null,
                        startDate: '',
                        endDate: '',
                        tags: '',
                    },
                    grouping: 'none' as const,
                    createdAt: new Date().toISOString(),
                },
            ];

            localStorageMock.store['liquitask_saved_views'] = JSON.stringify(savedViews);

            const { result } = renderHook(() => useSavedViews());

            expect(result.current.views.length).toBeGreaterThan(0);
            expect(result.current.views.some(v => v.name === 'Custom View')).toBe(true);
        });
    });

    describe('createView', () => {
        it('should create a new view', () => {
            const { result } = renderHook(() => useSavedViews());

            const filters: FilterState = {
                assignee: 'John',
                dateRange: 'due',
                startDate: '2024-01-01',
                endDate: '2024-01-31',
                tags: 'urgent',
            };

            let newView;
            act(() => {
                newView = result.current.createView('New View', filters, 'priority');
            });

            expect(newView).not.toBeNull();
            expect(newView?.name).toBe('New View');
            expect(newView?.grouping).toBe('priority');
            expect(result.current.views.some(v => v.id === newView?.id)).toBe(true);
        });

        it('should not create view if max limit reached', () => {
            const { result } = renderHook(() => useSavedViews());

            // Create 20 views (max limit)
            act(() => {
                for (let i = 0; i < 20; i++) {
                    result.current.createView(`View ${i}`, {
                        assignee: '',
                        dateRange: null,
                        startDate: '',
                        endDate: '',
                        tags: '',
                    });
                }
            });

            const viewCount = result.current.views.length;

            let newView;
            act(() => {
                newView = result.current.createView('Should Fail', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
            });

            expect(newView).toBeNull();
            expect(result.current.views.length).toBe(viewCount);
        });

        it('should trim view name', () => {
            const { result } = renderHook(() => useSavedViews());

            let newView;
            act(() => {
                newView = result.current.createView('  Trimmed View  ', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
            });

            expect(newView?.name).toBe('Trimmed View');
        });
    });

    describe('updateView', () => {
        it('should update an existing view', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('Original', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.updateView(viewId!, {
                    name: 'Updated',
                    filters: {
                        assignee: 'John',
                        dateRange: null,
                        startDate: '',
                        endDate: '',
                        tags: '',
                    },
                });
            });

            const updatedView = result.current.views.find(v => v.id === viewId);
            expect(updatedView?.name).toBe('Updated');
            expect(updatedView?.filters.assignee).toBe('John');
        });
    });

    describe('deleteView', () => {
        it('should delete a view', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('To Delete', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            const initialCount = result.current.views.length;

            act(() => {
                result.current.deleteView(viewId!);
            });

            expect(result.current.views.length).toBe(initialCount - 1);
            expect(result.current.views.find(v => v.id === viewId)).toBeUndefined();
        });

        it('should clear active view if deleted view was active', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('Active View', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.applyView(viewId!);
            });

            expect(result.current.activeViewId).toBe(viewId);

            act(() => {
                result.current.deleteView(viewId!);
            });

            expect(result.current.activeViewId).toBeNull();
        });
    });

    describe('applyView', () => {
        it('should set view as active', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('View to Apply', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.applyView(viewId!);
            });

            expect(result.current.activeViewId).toBe(viewId);
            expect(result.current.activeView?.id).toBe(viewId);
        });

        it('should return undefined for non-existent view', () => {
            const { result } = renderHook(() => useSavedViews());

            let view;
            act(() => {
                view = result.current.applyView('non-existent');
            });

            expect(view).toBeUndefined();
        });
    });

    describe('clearActiveView', () => {
        it('should clear active view', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('View', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.applyView(viewId!);
            });

            expect(result.current.activeViewId).toBe(viewId);

            act(() => {
                result.current.clearActiveView();
            });

            expect(result.current.activeViewId).toBeNull();
        });
    });

    describe('setDefaultView', () => {
        it('should set a view as default', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('Default View', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.setDefaultView(viewId!);
            });

            const defaultView = result.current.getDefaultView();
            expect(defaultView?.id).toBe(viewId);
            expect(defaultView?.isDefault).toBe(true);
        });

        it('should unset default when setting to null', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('View', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.setDefaultView(viewId!);
            });

            expect(result.current.getDefaultView()?.id).toBe(viewId);

            act(() => {
                result.current.setDefaultView(null);
            });

            expect(result.current.getDefaultView()).toBeUndefined();
        });
    });

    describe('getDefaultView', () => {
        it('should return default view', () => {
            const { result } = renderHook(() => useSavedViews());

            // Should have a default view from initialization
            const defaultView = result.current.getDefaultView();
            expect(defaultView).toBeDefined();
            expect(defaultView?.isDefault).toBe(true);
        });
    });

    describe('renameView', () => {
        it('should rename a view', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('Original Name', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.renameView(viewId!, 'New Name');
            });

            const renamedView = result.current.views.find(v => v.id === viewId);
            expect(renamedView?.name).toBe('New Name');
        });

        it('should trim renamed view name', () => {
            const { result } = renderHook(() => useSavedViews());

            let viewId;
            act(() => {
                const view = result.current.createView('Original', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            act(() => {
                result.current.renameView(viewId!, '  Trimmed  ');
            });

            const renamedView = result.current.views.find(v => v.id === viewId);
            expect(renamedView?.name).toBe('Trimmed');
        });
    });

    describe('duplicateView', () => {
        it('should duplicate a view', () => {
            const { result } = renderHook(() => useSavedViews());

            let originalId;
            act(() => {
                const view = result.current.createView('Original', {
                    assignee: 'John',
                    dateRange: 'due',
                    startDate: '2024-01-01',
                    endDate: '2024-01-31',
                    tags: 'urgent',
                }, 'priority');
                originalId = view?.id;
            });

            const initialCount = result.current.views.length;

            let duplicated;
            act(() => {
                duplicated = result.current.duplicateView(originalId!);
            });

            expect(duplicated).not.toBeNull();
            expect(duplicated?.name).toBe('Original (Copy)');
            expect(duplicated?.filters.assignee).toBe('John');
            expect(duplicated?.grouping).toBe('priority');
            expect(result.current.views.length).toBe(initialCount + 1);
        });

        it('should return null if max limit reached', () => {
            const { result } = renderHook(() => useSavedViews());

            // Create 20 views
            let viewId;
            act(() => {
                for (let i = 0; i < 19; i++) {
                    result.current.createView(`View ${i}`, {
                        assignee: '',
                        dateRange: null,
                        startDate: '',
                        endDate: '',
                        tags: '',
                    });
                }
                const view = result.current.createView('Last View', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
                viewId = view?.id;
            });

            let duplicated;
            act(() => {
                duplicated = result.current.duplicateView(viewId!);
            });

            expect(duplicated).toBeNull();
        });

        it('should return null for non-existent view', () => {
            const { result } = renderHook(() => useSavedViews());

            let duplicated;
            act(() => {
                duplicated = result.current.duplicateView('non-existent');
            });

            expect(duplicated).toBeNull();
        });
    });

    describe('persistence', () => {
        it('should persist views to localStorage', () => {
            const { result } = renderHook(() => useSavedViews());

            act(() => {
                result.current.createView('Persisted View', {
                    assignee: '',
                    dateRange: null,
                    startDate: '',
                    endDate: '',
                    tags: '',
                });
            });

            expect(localStorageMock.setItem).toHaveBeenCalled();
            const saved = JSON.parse(localStorageMock.store['liquitask_saved_views'] || '[]');
            expect(saved.some((v: any) => v.name === 'Persisted View')).toBe(true);
        });
    });
});

