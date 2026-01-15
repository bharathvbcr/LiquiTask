import { Task, TaskTemplate } from '../../types';

export class TemplateService {
    private templates: TaskTemplate[] = [];

    /**
     * Load templates from storage
     */
    loadTemplates(templates: TaskTemplate[]): void {
        this.templates = templates;
    }

    /**
     * Get all templates
     */
    getAllTemplates(): TaskTemplate[] {
        return [...this.templates];
    }

    /**
     * Get template by ID
     */
    getTemplate(templateId: string): TaskTemplate | undefined {
        return this.templates.find(t => t.id === templateId);
    }

    /**
     * Create task from template
     */
    createFromTemplate(templateId: string, variables?: Record<string, string>): Partial<Task> {
        const template = this.getTemplate(templateId);
        if (!template) {
            throw new Error(`Template ${templateId} not found`);
        }

        // Replace variables in task data
        const taskData = this.replaceVariables(template.taskData, variables || {});

        return {
            ...(taskData && typeof taskData === 'object' ? taskData : {}),
            // Reset instance-specific fields
            id: undefined, // Will be generated on creation
            createdAt: undefined,
            updatedAt: undefined,
            completedAt: undefined,
        };
    }

    /**
     * Save task as template
     */
    saveAsTemplate(task: Task, name: string, description?: string): TaskTemplate {
        const template: TaskTemplate = {
            id: `template-${Date.now()}`,
            name,
            description: description || `Template created from task "${task.title}"`,
            taskData: {
                title: task.title,
                subtitle: task.subtitle,
                summary: task.summary,
                assignee: task.assignee,
                priority: task.priority,
                status: task.status,
                tags: task.tags,
                timeEstimate: task.timeEstimate,
                subtasks: task.subtasks,
                customFieldValues: task.customFieldValues,
            },
            subtasks: task.subtasks || [],
            tags: task.tags || [],
            customFieldValues: task.customFieldValues || {},
            variables: this.extractVariables(task),
        };

        this.templates.push(template);
        return template;
    }

    /**
     * Delete template
     */
    deleteTemplate(templateId: string): void {
        this.templates = this.templates.filter(t => t.id !== templateId);
    }

    /**
     * Update template
     */
    updateTemplate(templateId: string, updates: Partial<TaskTemplate>): void {
        const index = this.templates.findIndex(t => t.id === templateId);
        if (index !== -1) {
            this.templates[index] = { ...this.templates[index], ...updates };
        }
    }

    /**
     * Replace variables in template data
     */
    private replaceVariables(data: unknown, variables: Record<string, string>): unknown {
        if (typeof data === 'string') {
            // Replace {{variable}} patterns
            return data.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
                return variables[varName] || match;
            });
        }

        if (Array.isArray(data)) {
            return data.map(item => this.replaceVariables(item, variables));
        }

        if (typeof data === 'object' && data !== null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result: any = {};
            for (const key in data) {
                result[key] = this.replaceVariables(data[key], variables);
            }
            return result;
        }

        return data;
    }

    /**
     * Extract variable names from task data
     */
    private extractVariables(task: Task): string[] {
        const variables: string[] = [];
        const text = JSON.stringify(task);

        // Find all {{variable}} patterns
        const matches = text.match(/\{\{(\w+)\}\}/g);
        if (matches) {
            matches.forEach(match => {
                const varName = match.replace(/\{\{|\}\}/g, '');
                if (!variables.includes(varName)) {
                    variables.push(varName);
                }
            });
        }

        return variables;
    }
}

// Singleton instance
export const templateService = new TemplateService();
