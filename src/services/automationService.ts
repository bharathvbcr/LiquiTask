import { Task } from '../../types';
import { FilterGroup } from '../types/queryTypes';
import { executeAdvancedFilter } from '../utils/queryEngine';

export type AutomationTrigger = 'onCreate' | 'onUpdate' | 'onMove' | 'onComplete' | 'onSchedule';
export type AutomationAction = 'setField' | 'addTag' | 'removeTag' | 'moveToColumn' | 'setPriority' | 'notify';

export interface AutomationRule {
    id: string;
    name: string;
    enabled: boolean;
    trigger: AutomationTrigger;
    conditions?: FilterGroup; // Optional filter conditions
    actions: Array<{
        type: AutomationAction;
        field?: string; // For setField
        value: unknown;
    }>;
    schedule?: {
        frequency: 'daily' | 'weekly' | 'monthly';
        time: string; // HH:mm format
    };
}

export interface TaskContext {
    previousTask?: Task;
    newTask: Task;
    changedFields?: string[];
}

export class AutomationService {
    private rules: AutomationRule[] = [];
    private scheduleInterval: NodeJS.Timeout | null = null;

    /**
     * Load rules from storage
     */
    loadRules(rules: AutomationRule[]): void {
        this.rules = rules;
        this.startScheduler();
    }

    /**
     * Save rules to storage
     */
    getRules(): AutomationRule[] {
        return [...this.rules];
    }

    /**
     * Add a new rule
     */
    addRule(rule: AutomationRule): void {
        this.rules.push(rule);
        this.startScheduler();
    }

    /**
     * Update a rule
     */
    updateRule(ruleId: string, updates: Partial<AutomationRule>): void {
        const index = this.rules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            this.rules[index] = { ...this.rules[index], ...updates };
            this.startScheduler();
        }
    }

    /**
     * Delete a rule
     */
    deleteRule(ruleId: string): void {
        this.rules = this.rules.filter(r => r.id !== ruleId);
        this.startScheduler();
    }

    /**
     * Process task event and execute matching rules
     */
    processTaskEvent(
        event: AutomationTrigger,
        context: TaskContext,
        allTasks: Task[]
    ): Partial<Task> | null {
        const matchingRules = this.rules.filter(rule =>
            rule.enabled &&
            rule.trigger === event &&
            this.evaluateConditions(rule, context.newTask, allTasks)
        );

        if (matchingRules.length === 0) return null;

        // Apply all matching rule actions
        const updates: Partial<Task> = {};
        const tagsToAdd: string[] = [];
        const tagsToRemove: string[] = [];

        matchingRules.forEach(rule => {
            rule.actions.forEach(action => {
                switch (action.type) {
                    case 'setField':
                        if (action.field) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (updates as any)[action.field] = action.value;
                        }
                        break;
                    case 'addTag':
                        if (typeof action.value === 'string') {
                            tagsToAdd.push(action.value);
                        }
                        break;
                    case 'removeTag':
                        if (typeof action.value === 'string') {
                            tagsToRemove.push(action.value);
                        }
                        break;
                    case 'moveToColumn':
                        updates.status = action.value as string;
                        break;
                    case 'setPriority':
                        updates.priority = action.value as string;
                        break;
                }
            });
        });

        // Merge tag changes
        if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
            const currentTags = context.newTask.tags || [];
            const newTags = [
                ...currentTags.filter(t => !tagsToRemove.includes(t)),
                ...tagsToAdd.filter(t => !currentTags.includes(t)),
            ];
            updates.tags = newTags;
        }

        return Object.keys(updates).length > 0 ? updates : null;
    }

    /**
     * Evaluate rule conditions
     */
    private evaluateConditions(rule: AutomationRule, task: Task, _allTasks: Task[]): boolean {
        if (!rule.conditions || rule.conditions.rules.length === 0) {
            return true; // No conditions = always match
        }

        return executeAdvancedFilter([task], rule.conditions).length > 0;
    }

    /**
     * Start scheduler for scheduled rules
     */
    private startScheduler(): void {
        if (this.scheduleInterval) {
            clearInterval(this.scheduleInterval);
        }

        const hasScheduledRules = this.rules.some(r => r.enabled && r.trigger === 'onSchedule');
        if (!hasScheduledRules) return;

        // Check every minute for scheduled rules
        this.scheduleInterval = setInterval(() => {
            const now = new Date();
            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            this.rules
                .filter(r => r.enabled && r.trigger === 'onSchedule' && r.schedule)
                .forEach(rule => {
                    if (rule.schedule!.time === currentTime) {
                        // Execute scheduled rule (would need task list passed in)
                        // This is a placeholder - actual implementation would need access to all tasks
                    }
                });
        }, 60000); // Check every minute
    }

    /**
     * Stop scheduler
     */
    stop(): void {
        if (this.scheduleInterval) {
            clearInterval(this.scheduleInterval);
            this.scheduleInterval = null;
        }
    }
}

// Singleton instance
export const automationService = new AutomationService();
