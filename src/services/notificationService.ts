// Check if Electron notifications are available
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

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
        this.requestPermission();
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

        if (isElectron && (window as any).electronAPI?.showNotification) {
            (window as any).electronAPI.showNotification({
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
}

export const notificationService = new NotificationService();
export default notificationService;
