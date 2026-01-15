import { Task, RecurringConfig } from '../../types';

export interface RecurringTaskServiceOptions {
    onCreateTask: (task: Task) => void;
    onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
}

/**
 * Service for managing recurring task generation
 */
export class RecurringTaskService {
    private checkInterval: NodeJS.Timeout | null = null;
    private isRunning = false;
    private onCreateTask: (task: Task) => void;
    private onUpdateTask: (taskId: string, updates: Partial<Task>) => void;

    constructor(options: RecurringTaskServiceOptions) {
        this.onCreateTask = options.onCreateTask;
        this.onUpdateTask = options.onUpdateTask;
    }

    /**
     * Start the recurring task scheduler
     * Checks every 5 minutes for tasks that need to be generated
     */
    start(tasks: Task[]): void {
        if (this.isRunning) {
            this.stop();
        }

        this.isRunning = true;
        
        // Check immediately on start
        this.checkAndGenerate(tasks);

        // Then check every 5 minutes
        this.checkInterval = setInterval(() => {
            this.checkAndGenerate(tasks);
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Stop the scheduler
     */
    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
    }

    /**
     * Check all tasks and generate recurring instances as needed
     */
    private checkAndGenerate(tasks: Task[]): void {
        const now = new Date();
        
        tasks.forEach(originalTask => {
            if (!originalTask.recurring?.enabled) return;
            if (!originalTask.recurring.nextOccurrence) return;

            const nextOccurrence = new Date(originalTask.recurring.nextOccurrence);
            
            // Check if it's time to generate a new instance
            if (now >= nextOccurrence) {
                this.generateRecurringInstance(originalTask);
            }
        });
    }

    /**
     * Generate a new instance of a recurring task
     */
    private generateRecurringInstance(originalTask: Task): void {
        if (!originalTask.recurring) return;

        const now = new Date();
        const newTask: Task = {
            ...originalTask,
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
            createdAt: now,
            updatedAt: now,
            // Reset status to first column (typically "Pending")
            status: originalTask.status, // Or could reset to first column
            // Reset completion state
            completedAt: undefined,
            // Calculate next occurrence
            recurring: {
                ...originalTask.recurring,
                nextOccurrence: this.calculateNextOccurrence(originalTask.recurring, now),
            },
            // Reset activity log for new instance
            activity: [{
                id: `act-${Date.now()}`,
                type: 'create',
                timestamp: now,
                userId: 'system',
                details: `Recurring task instance generated from ${originalTask.jobId}`,
            }],
        };

        // Create the new task
        this.onCreateTask(newTask);

        // Update the original task's nextOccurrence
        this.onUpdateTask(originalTask.id, {
            recurring: {
                ...originalTask.recurring,
                nextOccurrence: newTask.recurring?.nextOccurrence,
            },
        });
    }

    /**
     * Calculate the next occurrence date based on recurrence configuration
     */
    calculateNextOccurrence(config: RecurringConfig, fromDate: Date = new Date()): Date {
        const next = new Date(fromDate);

        switch (config.frequency) {
            case 'daily':
                next.setDate(next.getDate() + config.interval);
                break;

            case 'weekly':
                if (config.daysOfWeek && config.daysOfWeek.length > 0) {
                    // Find next matching day of week
                    const currentDay = next.getDay();
                    const sortedDays = [...config.daysOfWeek].sort((a, b) => a - b);
                    
                    // Find next day this week
                    const nextDayThisWeek = sortedDays.find(day => day > currentDay);
                    if (nextDayThisWeek !== undefined) {
                        next.setDate(next.getDate() + (nextDayThisWeek - currentDay));
                    } else {
                        // Next occurrence is next week
                        const daysUntilNext = 7 - currentDay + sortedDays[0];
                        next.setDate(next.getDate() + daysUntilNext);
                    }
                } else {
                    // Default: same day of week, every N weeks
                    next.setDate(next.getDate() + (7 * config.interval));
                }
                break;

            case 'monthly':
                if (config.dayOfMonth) {
                    // Set to specific day of month
                    next.setMonth(next.getMonth() + config.interval);
                    next.setDate(config.dayOfMonth);
                    
                    // If day doesn't exist in that month (e.g., Feb 30), use last day
                    if (next.getDate() !== config.dayOfMonth) {
                        next.setDate(0); // Last day of previous month
                    }
                } else {
                    // Same day of month, N months later
                    next.setMonth(next.getMonth() + config.interval);
                }
                break;

            case 'custom':
                // For custom, use interval as days (can be enhanced later)
                next.setDate(next.getDate() + config.interval);
                break;
        }

        // Check if endDate is set and we've passed it
        if (config.endDate && next > config.endDate) {
            // Recurrence has ended, disable it
            return next; // Return the date but caller should disable
        }

        return next;
    }

    /**
     * Manually trigger generation for a specific task (for testing or manual triggers)
     */
    generateNow(task: Task): void {
        if (!task.recurring?.enabled) return;
        this.generateRecurringInstance(task);
    }

    /**
     * Update nextOccurrence for a task (useful when task is completed)
     */
    updateNextOccurrence(task: Task): void {
        if (!task.recurring?.enabled) return;
        
        const nextOccurrence = this.calculateNextOccurrence(task.recurring);
        this.onUpdateTask(task.id, {
            recurring: {
                ...task.recurring,
                nextOccurrence,
            },
        });
    }
}

// Singleton instance (will be initialized in App.tsx)
let _recurringTaskService: RecurringTaskService | null = null;

export function initializeRecurringTaskService(options: RecurringTaskServiceOptions): RecurringTaskService {
    _recurringTaskService = new RecurringTaskService(options);
    return _recurringTaskService;
}

export function getRecurringTaskService(): RecurringTaskService | null {
    return _recurringTaskService;
}

// For backward compatibility
export const recurringTaskService = {
    get instance() {
        return _recurringTaskService;
    },
    start: (tasks: Task[]) => _recurringTaskService?.start(tasks),
    stop: () => _recurringTaskService?.stop(),
    calculateNextOccurrence: (config: RecurringConfig, fromDate?: Date) => 
        _recurringTaskService?.calculateNextOccurrence(config, fromDate),
    updateNextOccurrence: (task: Task) => _recurringTaskService?.updateNextOccurrence(task),
};
