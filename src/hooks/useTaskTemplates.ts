import { useState, useCallback, useEffect } from 'react';
import { Task } from '../../types';
import { STORAGE_KEYS } from '../constants';

export interface TaskTemplate {
    id: string;
    name: string;
    description?: string;
    taskDefaults: Partial<Task>;
    createdAt: Date;
}

const MAX_TEMPLATES = 50;

export function useTaskTemplates() {
    const [templates, setTemplates] = useState<TaskTemplate[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.TASK_TEMPLATES);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.map((t: TaskTemplate) => ({
                    ...t,
                    createdAt: new Date(t.createdAt),
                }));
            }
        } catch (e) {
            console.error('Failed to load task templates:', e);
        }
        return [];
    });

    // Persist templates to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEYS.TASK_TEMPLATES, JSON.stringify(templates));
        } catch (e) {
            console.error('Failed to save task templates:', e);
        }
    }, [templates]);

    const createTemplate = useCallback((name: string, taskDefaults: Partial<Task>, description?: string) => {
        const newTemplate: TaskTemplate = {
            id: `template-${Date.now()}`,
            name,
            description,
            taskDefaults: {
                ...taskDefaults,
                // Remove runtime-specific fields
                id: undefined,
                jobId: undefined,
                projectId: undefined,
                createdAt: undefined,
            },
            createdAt: new Date(),
        };

        setTemplates(prev => {
            const updated = [newTemplate, ...prev];
            // Limit to MAX_TEMPLATES
            return updated.slice(0, MAX_TEMPLATES);
        });

        return newTemplate;
    }, []);

    const updateTemplate = useCallback((id: string, updates: Partial<Omit<TaskTemplate, 'id' | 'createdAt'>>) => {
        setTemplates(prev => prev.map(t =>
            t.id === id ? { ...t, ...updates } : t
        ));
    }, []);

    const deleteTemplate = useCallback((id: string) => {
        setTemplates(prev => prev.filter(t => t.id !== id));
    }, []);

    const applyTemplate = useCallback((templateId: string): Partial<Task> | null => {
        const template = templates.find(t => t.id === templateId);
        if (!template) return null;

        return {
            ...template.taskDefaults,
            // Generate new IDs for applied tasks
            id: undefined,
            jobId: undefined,
        };
    }, [templates]);

    return {
        templates,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        applyTemplate,
    };
}

export default useTaskTemplates;
