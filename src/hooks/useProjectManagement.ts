import { useState, useCallback } from 'react';
import { Project, ToastType } from '../../types';
import { storageService } from '../services/storageService';
import { STORAGE_KEYS, DEFAULT_PROJECTS } from '../constants';

interface UseProjectManagementProps {
    addToast: (message: string, type: ToastType) => void;
}

export function useProjectManagement({ addToast }: UseProjectManagementProps) {
    const [projects, setProjects] = useState<Project[]>(() =>
        storageService.get(STORAGE_KEYS.PROJECTS, [...DEFAULT_PROJECTS] as Project[])
    );

    const [activeProjectId, setActiveProjectId] = useState<string>(() =>
        storageService.get(STORAGE_KEYS.ACTIVE_PROJECT, projects[0]?.id || '')
    );

    // Save projects to storage
    const saveProjects = useCallback((newProjects: Project[]) => {
        setProjects(newProjects);
        storageService.set(STORAGE_KEYS.PROJECTS, newProjects);
    }, []);

    // Save active project ID
    const setActiveProject = useCallback((id: string) => {
        setActiveProjectId(id);
        storageService.set(STORAGE_KEYS.ACTIVE_PROJECT, id);
    }, []);

    // Get active project
    const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || { name: 'No Project', id: 'temp' };

    // Create project
    const createProject = useCallback((name: string, type: string, parentId?: string) => {
        const siblings = projects.filter(p => p.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(p => p.order || 0)) : -1;

        const newProject: Project = {
            id: `p-${Date.now()}`,
            name,
            type,
            parentId,
            order: maxOrder + 1,
        };

        saveProjects([...projects, newProject]);

        if (!parentId) {
            setActiveProject(newProject.id);
        }

        addToast(`Workspace "${name}" created`, 'success');
        return newProject;
    }, [projects, saveProjects, setActiveProject, addToast]);

    // Delete project
    const deleteProject = useCallback((id: string, onDeleteTasks: (projectId: string) => void) => {
        const hasChildren = projects.some(p => p.parentId === id);
        if (hasChildren) {
            addToast('Cannot delete a project that has sub-projects.', 'error');
            return false;
        }


        if (window.confirm('Delete this workspace? All associated tasks will be removed.')) {
            const newProjects = projects.filter(p => p.id !== id);
            saveProjects(newProjects);
            onDeleteTasks(id);

            if (activeProjectId === id) {
                if (newProjects.length > 0) {
                    setActiveProject(newProjects[0].id);
                } else {
                    setActiveProject('');
                }
            }

            addToast('Workspace deleted', 'info');
            return true;
        }
        return false;
    }, [projects, activeProjectId, saveProjects, setActiveProject, addToast]);

    // Toggle pin
    const togglePin = useCallback((projectId: string) => {
        saveProjects(projects.map(p =>
            p.id === projectId ? { ...p, pinned: !p.pinned } : p
        ));
    }, [projects, saveProjects]);

    // Move project up/down
    const moveProject = useCallback((projectId: string, direction: 'up' | 'down') => {
        const targetProject = projects.find(p => p.id === projectId);
        if (!targetProject) return;

        const isPinned = !!targetProject.pinned;
        const parentId = targetProject.parentId;

        const siblings = projects.filter(p => p.parentId === parentId && !!p.pinned === isPinned);
        siblings.sort((a, b) => (a.order || 0) - (b.order || 0));

        const currentIndex = siblings.findIndex(p => p.id === projectId);
        if (currentIndex === -1) return;

        const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (swapIndex < 0 || swapIndex >= siblings.length) return;

        const reordered = [...siblings];
        [reordered[currentIndex], reordered[swapIndex]] = [reordered[swapIndex], reordered[currentIndex]];

        const orderMap = new Map<string, number>();
        reordered.forEach((p, idx) => orderMap.set(p.id, idx));

        saveProjects(projects.map(p =>
            orderMap.has(p.id) ? { ...p, order: orderMap.get(p.id) } : p
        ));
    }, [projects, saveProjects]);

    return {
        projects,
        setProjects: saveProjects,
        activeProjectId,
        setActiveProjectId: setActiveProject,
        activeProject,
        createProject,
        deleteProject,
        togglePin,
        moveProject,
    };
}
