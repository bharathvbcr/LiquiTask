import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectManagement } from '../useProjectManagement';
import { storageService } from '../../services/storageService';
import { STORAGE_KEYS } from '../../constants';

// Mock storage service
vi.mock('../../services/storageService', () => ({
    storageService: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

describe('useProjectManagement', () => {
    const mockAddToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([]);
        window.confirm = vi.fn(() => true);
    });

    describe('initialization', () => {
        it('should initialize with default projects', () => {
            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            expect(result.current.projects).toBeDefined();
            expect(Array.isArray(result.current.projects)).toBe(true);
        });

        it('should load projects from storage', () => {
            const storedProjects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];

            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(storedProjects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            expect(result.current.projects).toHaveLength(2);
            expect(result.current.projects[0].name).toBe('Project 1');
        });

        it('should set active project from storage', () => {
            const storedProjects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];

            (storageService.get as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(storedProjects)
                .mockReturnValueOnce('p2');

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            expect(result.current.activeProjectId).toBe('p2');
        });
    });

    describe('createProject', () => {
        it('should create a new project', () => {
            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.createProject('New Project', 'folder');
            });

            expect(result.current.projects.length).toBeGreaterThan(0);
            const newProject = result.current.projects.find(p => p.name === 'New Project');
            expect(newProject).toBeDefined();
            expect(newProject?.type).toBe('folder');
            expect(mockAddToast).toHaveBeenCalledWith('Workspace "New Project" created', 'success');
        });

        it('should set new project as active if no parent', () => {
            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.createProject('New Project', 'folder');
            });

            const newProject = result.current.projects.find(p => p.name === 'New Project');
            expect(result.current.activeProjectId).toBe(newProject?.id);
        });

        it('should create sub-project with parentId', () => {
            const parentProject = { id: 'p1', name: 'Parent', type: 'folder' };
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([parentProject]);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.createProject('Sub Project', 'folder', 'p1');
            });

            const subProject = result.current.projects.find(p => p.name === 'Sub Project');
            expect(subProject?.parentId).toBe('p1');
            expect(result.current.activeProjectId).not.toBe(subProject?.id);
        });

        it('should assign order to new project', () => {
            const existingProjects = [
                { id: 'p1', name: 'Project 1', type: 'folder', order: 0 },
                { id: 'p2', name: 'Project 2', type: 'folder', order: 1 },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(existingProjects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.createProject('New Project', 'folder');
            });

            const newProject = result.current.projects.find(p => p.name === 'New Project');
            expect(newProject?.order).toBe(2);
        });
    });

    describe('deleteProject', () => {
        it('should delete a project', async () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const mockDeleteTasks = vi.fn();

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            await act(async () => {
                const deleted = await result.current.deleteProject('p1', mockDeleteTasks);
                expect(deleted).toBe(true);
            });

            expect(result.current.projects.find(p => p.id === 'p1')).toBeUndefined();
            expect(mockDeleteTasks).toHaveBeenCalledWith('p1');
            expect(mockAddToast).toHaveBeenCalledWith('Workspace deleted', 'info');
        });

        it('should not delete if project has children', async () => {
            const projects = [
                { id: 'p1', name: 'Parent', type: 'folder' },
                { id: 'p2', name: 'Child', type: 'folder', parentId: 'p1' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const mockDeleteTasks = vi.fn();

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            await act(async () => {
                const deleted = await result.current.deleteProject('p1', mockDeleteTasks);
                expect(deleted).toBe(false);
            });

            expect(result.current.projects.find(p => p.id === 'p1')).toBeDefined();
            expect(mockAddToast).toHaveBeenCalledWith(
                'Cannot delete a project that has sub-projects.',
                'error'
            );
        });

        it('should allow deletion of last project if confirmed', async () => {
            const projects = [{ id: 'p1', name: 'Last Project', type: 'folder' }];
            (storageService.get as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(projects)
                .mockReturnValueOnce('p1');

            const mockDeleteTasks = vi.fn();
            window.confirm = vi.fn(() => true);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            // The hook implementation doesn't prevent deleting the last project
            // It will delete if confirmed (this matches App.tsx behavior which does check)
            await act(async () => {
                const deleted = await result.current.deleteProject('p1', mockDeleteTasks);
                // The hook itself doesn't check, so it will delete if confirmed
                expect(deleted).toBe(true);
            });

            // Project will be deleted
            expect(result.current.projects.find(p => p.id === 'p1')).toBeUndefined();
        });

        it('should switch active project if deleted project was active', async () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(projects)
                .mockReturnValueOnce('p1');

            const mockDeleteTasks = vi.fn();

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            await act(async () => {
                await result.current.deleteProject('p1', mockDeleteTasks);
            });

            expect(result.current.activeProjectId).toBe('p2');
        });

        it('should not delete if user cancels confirmation', async () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);
            window.confirm = vi.fn(() => false);

            const mockDeleteTasks = vi.fn();

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            await act(async () => {
                const deleted = await result.current.deleteProject('p1', mockDeleteTasks);
                expect(deleted).toBe(false);
            });

            expect(result.current.projects.find(p => p.id === 'p1')).toBeDefined();
            expect(mockDeleteTasks).not.toHaveBeenCalled();
        });
    });

    describe('togglePin', () => {
        it('should toggle pin status of a project', () => {
            const projects = [{ id: 'p1', name: 'Project 1', type: 'folder', pinned: false }];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.togglePin('p1');
            });

            expect(result.current.projects.find(p => p.id === 'p1')?.pinned).toBe(true);

            act(() => {
                result.current.togglePin('p1');
            });

            expect(result.current.projects.find(p => p.id === 'p1')?.pinned).toBe(false);
        });
    });

    describe('moveProject', () => {
        it('should move project up', () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder', order: 0 },
                { id: 'p2', name: 'Project 2', type: 'folder', order: 1 },
                { id: 'p3', name: 'Project 3', type: 'folder', order: 2 },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.moveProject('p2', 'up');
            });

            const p2 = result.current.projects.find(p => p.id === 'p2');
            const p1 = result.current.projects.find(p => p.id === 'p1');
            expect(p2?.order).toBeLessThan(p1?.order || 0);
        });

        it('should move project down', () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder', order: 0 },
                { id: 'p2', name: 'Project 2', type: 'folder', order: 1 },
                { id: 'p3', name: 'Project 3', type: 'folder', order: 2 },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.moveProject('p2', 'down');
            });

            const p2 = result.current.projects.find(p => p.id === 'p2');
            const p3 = result.current.projects.find(p => p.id === 'p3');
            expect(p2?.order).toBeGreaterThan(p3?.order || 0);
        });

        it('should only move within siblings with same pinned status', () => {
            const projects = [
                { id: 'p1', name: 'Pinned 1', type: 'folder', order: 0, pinned: true },
                { id: 'p2', name: 'Pinned 2', type: 'folder', order: 1, pinned: true },
                { id: 'p3', name: 'Unpinned 1', type: 'folder', order: 0, pinned: false },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.moveProject('p2', 'up');
            });

            const p2 = result.current.projects.find(p => p.id === 'p2');
            const p3 = result.current.projects.find(p => p.id === 'p3');
            // p2 should not affect p3's order
            expect(p2?.order).toBe(0);
            expect(p3?.order).toBe(0);
        });

        it('should not move if already at boundary', () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder', order: 0 },
                { id: 'p2', name: 'Project 2', type: 'folder', order: 1 },
            ];
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue(projects);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            const initialOrder = result.current.projects.find(p => p.id === 'p1')?.order;

            act(() => {
                result.current.moveProject('p1', 'up');
            });

            expect(result.current.projects.find(p => p.id === 'p1')?.order).toBe(initialOrder);
        });
    });

    describe('setActiveProject', () => {
        it('should set active project ID', () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(projects)
                .mockReturnValueOnce('p1');

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            act(() => {
                result.current.setActiveProjectId('p2');
            });

            expect(result.current.activeProjectId).toBe('p2');
            expect(storageService.set).toHaveBeenCalledWith(STORAGE_KEYS.ACTIVE_PROJECT, 'p2');
        });
    });

    describe('activeProject', () => {
        it('should return active project', () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(projects)
                .mockReturnValueOnce('p2');

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            expect(result.current.activeProject.id).toBe('p2');
            expect(result.current.activeProject.name).toBe('Project 2');
        });

        it('should return first project if active project not found', () => {
            const projects = [
                { id: 'p1', name: 'Project 1', type: 'folder' },
                { id: 'p2', name: 'Project 2', type: 'dev' },
            ];
            (storageService.get as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(projects)
                .mockReturnValueOnce('p999');

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            expect(result.current.activeProject.id).toBe('p1');
        });

        it('should return default project if no projects exist', () => {
            (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue([]);

            const { result } = renderHook(() =>
                useProjectManagement({ addToast: mockAddToast })
            );

            expect(result.current.activeProject.name).toBe('No Project');
        });
    });
});

