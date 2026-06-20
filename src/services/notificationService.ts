import { getDesktopApi, getRuntimeKind, isDesktop } from "../runtime/runtimeEnvironment";

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
  // Tracks active timeout handles per task so re-scheduling or cancellation
  // can clear stale timers and prevent duplicate / phantom notifications.
  private taskReminderHandles: Map<string, ReturnType<typeof setTimeout>[]> = new Map();

  async requestPermission(): Promise<boolean> {
    const runtime = getRuntimeKind();
    const desktopApi = getDesktopApi();

    if (runtime !== "web" && desktopApi?.showNotification) {
      this.hasPermission = true;
      return true;
    }

    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      this.hasPermission = permission === "granted";
      return this.hasPermission;
    }

    return false;
  }

  show(options: NotificationOptions): void {
    if (!this.hasPermission) {
      console.warn("Notification permission not granted");
      return;
    }

    const desktopApi = getDesktopApi();
    if (isDesktop() && desktopApi?.showNotification) {
      desktopApi.showNotification({
        title: options.title,
        body: options.body,
        silent: options.silent,
      });
      return;
    }

    if ("Notification" in window) {
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

  // Cancel any pending reminders for a task (call on delete or completion).
  cancelTaskReminder(taskId: string): void {
    const handles = this.taskReminderHandles.get(taskId);
    if (handles) {
      handles.forEach((h) => clearTimeout(h));
      this.taskReminderHandles.delete(taskId);
    }
  }

  // Schedule a reminder for a task.
  // If called again for the same taskId (e.g. due date updated) the previous
  // timers are cancelled first so no duplicate / stale notifications fire.
  //
  // Privacy note: task titles are intentionally omitted from OS notification
  // bodies because the OS notification centre persists messages outside the
  // app and may sync them to cloud services (macOS iCloud, Windows notification
  // history), making sensitive titles visible to other users or services.
  scheduleTaskReminder(taskId: string, _taskTitle: string, dueDate: Date): void {
    // Clear any existing timers for this task before scheduling new ones.
    this.cancelTaskReminder(taskId);

    const now = new Date();
    const timeUntilDue = dueDate.getTime() - now.getTime();

    // Don't schedule if already past due
    if (timeUntilDue <= 0) return;

    const handles: ReturnType<typeof setTimeout>[] = [];

    // Remind 1 hour before (or immediately if less than 1 hour)
    const reminderTime = Math.max(timeUntilDue - 60 * 60 * 1000, 0);
    const reminderBody =
      timeUntilDue < 60 * 60 * 1000
        ? `A task is due in ~${Math.max(1, Math.round(timeUntilDue / 60000))} minutes`
        : "A task is due in 1 hour";

    handles.push(
      setTimeout(() => {
        this.show({
          title: "⏰ Task Due Soon",
          // Task title omitted from body — see privacy note above.
          body: reminderBody,
          tag: `task-reminder-${taskId}`,
        });
      }, reminderTime),
    );

    // Also remind at due time
    if (timeUntilDue > 60 * 60 * 1000) {
      handles.push(
        setTimeout(() => {
          this.show({
            title: "🚨 Task Due Now",
            // Task title omitted from body — see privacy note above.
            body: "A task is due now",
            tag: `task-due-${taskId}`,
          });
        }, timeUntilDue),
      );
    }

    this.taskReminderHandles.set(taskId, handles);
  }

  // Check all tasks and schedule reminders
  scheduleAllReminders(tasks: Array<{ id: string; title: string; dueDate?: Date }>): void {
    tasks.forEach((task) => {
      if (task.dueDate) {
        this.scheduleTaskReminder(task.id, task.title, task.dueDate);
      }
    });
  }

  // Check for overdue tasks and return categorized results
  checkOverdueTasks(
    tasks: Array<{
      id: string;
      title: string;
      dueDate?: Date;
      status?: string;
      completedAt?: Date;
    }>,
  ): {
    overdue: typeof tasks;
    dueSoon: typeof tasks;
  } {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const overdue: typeof tasks = [];
    const dueSoon: typeof tasks = [];

    tasks.forEach((task) => {
      if (!task.dueDate || task.status === "Done" || task.completedAt) return;

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
        title: "⚠️ Overdue Task",
        body: 'A task is past due',
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
    getTasks: () => Array<{
      id: string;
      title: string;
      dueDate?: Date;
      status?: string;
      completedAt?: Date;
    }>,
    intervalMs: number = 60000,
  ): void {
    if (this.checkIntervalId) {
      this.stopPeriodicCheck();
    }

    const check = () => {
      const tasks = getTasks();
      const { overdue } = this.checkOverdueTasks(tasks);

      const activeIds = new Set(
        tasks
          .filter((t) => t.status !== "Done" && !t.completedAt)
          .map((t) => t.id)
      );
      for (const id of this.notifiedOverdueIds) {
        if (!activeIds.has(id)) this.notifiedOverdueIds.delete(id);
      }

      // Only notify for newly overdue tasks
      const newlyOverdue = overdue.filter((t) => !this.notifiedOverdueIds.has(t.id));

      if (newlyOverdue.length > 0) {
        this.notifyOverdue(newlyOverdue);
        newlyOverdue.forEach((t) => {
          this.notifiedOverdueIds.add(t.id);
        });
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
