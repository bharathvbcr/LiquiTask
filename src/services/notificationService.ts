// Check if Electron notifications are available
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

interface NotificationOptions {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    silent?: boolean;
    onClick?: () => void;
}

class NotificationService {
    private hasPermission: boolean = false;

    constructor() {
        // Permission requested on user interaction
    }

    async requestPermission(): Promise<boolean> {
        if (isElectron) {
            // Electron has notification permission by default
            this.hasPermission = true;
            return true;
        }

        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            this.hasPermission = permission === 'granted';
            return this.hasPermission;
        }

        return false;
    }

    show(options: NotificationOptions): void {
        if (!this.hasPermission) {
            console.warn('Notification permission not granted');
            return;
        }

        if (isElectron && window.electronAPI?.showNotification) {
            window.electronAPI.showNotification({
                title: options.title,
                body: options.body,
            });
        } else if ('Notification' in window) {
            const notification = new Notification(options.title, {
                body: options.body,
                icon: options.icon,
                tag: options.tag,
                silent: options.silent,
            });

            if (options.onClick) {
                notification.onclick = options.onClick;
            }
        }
    }

    // Schedule a reminder for a task
    scheduleTaskReminder(taskId: string, taskTitle: string, dueDate: Date): void {
        const now = new Date();
        const timeUntilDue = dueDate.getTime() - now.getTime();

        // Don't schedule if already past due
        if (timeUntilDue <= 0) return;

        // Remind 1 hour before (or immediately if less than 1 hour)
        const reminderTime = Math.max(timeUntilDue - (60 * 60 * 1000), 0);

        setTimeout(() => {
            this.show({
                title: '⏰ Task Due Soon',
                body: `"${taskTitle}" is due in 1 hour`,
                tag: `task-reminder-${taskId}`,
            });
        }, reminderTime);

        // Also remind at due time
        if (timeUntilDue > 60 * 60 * 1000) {
            setTimeout(() => {
                this.show({
                    title: '🚨 Task Due Now',
                    body: `"${taskTitle}" is due now!`,
                    tag: `task-due-${taskId}`,
                });
            }, timeUntilDue);
        }
    }

    // Check all tasks and schedule reminders
    scheduleAllReminders(tasks: Array<{ id: string; title: string; dueDate?: Date }>): void {
        tasks.forEach(task => {
            if (task.dueDate) {
                this.scheduleTaskReminder(task.id, task.title, task.dueDate);
            }
        });
    }

    // Check for overdue tasks and return categorized results
    checkOverdueTasks(tasks: Array<{ id: string; title: string; dueDate?: Date; status?: string; completedAt?: Date }>): {
        overdue: typeof tasks;
        dueSoon: typeof tasks;
    } {
        const now = new Date();
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

        const overdue: typeof tasks = [];
        const dueSoon: typeof tasks = [];

        tasks.forEach(task => {
            if (!task.dueDate || task.status === 'Done' || task.completedAt) return;

            const dueDate = new Date(task.dueDate);

            if (dueDate < now) {
                overdue.push(task);
            } else if (dueDate <= oneHourFromNow) {
                dueSoon.push(task);
            }
        });

        return { overdue, dueSoon };
    }

    // Show notification for overdue tasks
    notifyOverdue(tasks: Array<{ title: string }>): void {
        if (tasks.length === 0) return;

        if (tasks.length === 1) {
            this.show({
                title: '⚠️ Overdue Task',
                body: `"${tasks[0].title}" is past due!`,
            });
        } else {
            this.show({
                title: `⚠️ ${tasks.length} Overdue Tasks`,
                body: `You have ${tasks.length} tasks that are past due`,
            });
        }
    }

    // Start periodic overdue checking
    private checkIntervalId: ReturnType<typeof setInterval> | null = null;
    private notifiedOverdueIds: Set<string> = new Set();

    startPeriodicCheck(
        getTasks: () => Array<{ id: string; title: string; dueDate?: Date; status?: string; completedAt?: Date }>,
        intervalMs: number = 60000
    ): void {
        if (this.checkIntervalId) {
            this.stopPeriodicCheck();
        }

        const check = () => {
            const tasks = getTasks();
            const { overdue } = this.checkOverdueTasks(tasks);

            // Only notify for newly overdue tasks
            const newlyOverdue = overdue.filter(t => !this.notifiedOverdueIds.has(t.id));

            if (newlyOverdue.length > 0) {
                this.notifyOverdue(newlyOverdue);
                newlyOverdue.forEach(t => this.notifiedOverdueIds.add(t.id));
            }
        };

        // Initial check
        check();

        // Set up interval
        this.checkIntervalId = setInterval(check, intervalMs);
    }

    stopPeriodicCheck(): void {
        if (this.checkIntervalId) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
        }
    }

    // Clear notified overdue tracking (e.g., when task is completed)
    clearOverdueNotification(taskId: string): void {
        this.notifiedOverdueIds.delete(taskId);
    }
}

export const notificationService = new NotificationService();
export default notificationService;
