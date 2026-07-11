import { getDesktopApi, getRuntimeKind, isDesktop } from "../runtime/runtimeEnvironment";
import { isTaskComplete } from "../utils/taskUtils";
import {
  type NotificationPreferences,
  isWithinQuietHours,
  readNotificationPreferences,
} from "../utils/notificationPreferences";

/** Collapse rapid agent-attention notifications (kanban-code parity). */
export const AGENT_ATTENTION_SUPPRESSION_MS = 62_000;

export type AgentAttentionKind =
  | "permission_request"
  | "run_waiting"
  | "run_completed"
  | "run_failed";

interface NotificationTask {
  id: string;
  title: string;
  dueDate?: Date;
  status?: string;
  completedAt?: Date;
}

interface NotificationCheckOptions {
  /** Static set of completed column ids (used when columns do not change). */
  completedColumnIds?: Set<string>;
  /** Live getter for completed column ids (preferred — tracks column config changes). */
  getCompletedColumnIds?: () => Set<string>;
}

function resolveCompletedColumnIds(options: NotificationCheckOptions): Set<string> {
  return options.getCompletedColumnIds?.() ?? options.completedColumnIds ?? new Set<string>();
}
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
  private preferences: NotificationPreferences = readNotificationPreferences();
  // Tracks active timeout handles per task so re-scheduling or cancellation
  // can clear stale timers and prevent duplicate / phantom notifications.
  private taskReminderHandles: Map<string, ReturnType<typeof setTimeout>[]> = new Map();
  /** Last shown timestamp per dedupe key for agent-attention events. */
  private agentAttentionLastShown: Map<string, number> = new Map();

  /** Refresh preferences from storage (call after settings change). */
  reloadPreferences(): void {
    this.preferences = readNotificationPreferences();
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  setPreferences(prefs: NotificationPreferences): void {
    this.preferences = { ...prefs };
  }

  private isQuietNow(): boolean {
    return isWithinQuietHours(new Date(), this.preferences);
  }

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

    if (this.isQuietNow()) {
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

  /**
   * Show an agent-attention notification with 62s dedupe suppression per kind+id.
   * Task titles are omitted from bodies for OS notification privacy (see scheduleTaskReminder).
   */
  notifyAgentAttention(
    kind: AgentAttentionKind,
    options: {
      dedupeId?: string;
      title: string;
      body: string;
      tag?: string;
    },
  ): void {
    if (!this.preferences.agentAttentionEnabled) return;

    const dedupeKey = `${kind}:${options.dedupeId ?? kind}`;
    const now = Date.now();
    const last = this.agentAttentionLastShown.get(dedupeKey) ?? 0;
    if (now - last < AGENT_ATTENTION_SUPPRESSION_MS) return;
    this.agentAttentionLastShown.set(dedupeKey, now);

    this.show({
      title: options.title,
      body: options.body,
      tag: options.tag ?? dedupeKey,
    });
  }

  notifyPermissionRequest(requestId: string, toolName?: string): void {
    const tool = toolName?.trim() || "tool";
    this.notifyAgentAttention("permission_request", {
      dedupeId: requestId,
      title: "Agent Waiting For Permission",
      body: `Approve or deny ${tool} to let the run continue.`,
      tag: `agent-permission-${requestId}`,
    });
  }

  notifyRunWaiting(agentName?: string, queuePosition?: number): void {
    const who = agentName?.trim() || "An agent";
    const position =
      typeof queuePosition === "number" && queuePosition > 0
        ? ` (position ${queuePosition} in queue)`
        : "";
    this.notifyAgentAttention("run_waiting", {
      dedupeId: `${agentName ?? "agent"}:${queuePosition ?? 0}`,
      title: "Agent Run Queued",
      body: `${who} is waiting to start${position}.`,
      tag: "agent-run-waiting",
    });
  }

  notifyRunCompleted(): void {
    this.notifyAgentAttention("run_completed", {
      dedupeId: "latest",
      title: "Agent Run Complete",
      body: "An agent finished work on a task — review the diff and commit it.",
      tag: "agent-run-completed",
    });
  }

  notifyRunFailed(reason?: string): void {
    const detail = reason?.trim();
    this.notifyAgentAttention("run_failed", {
      dedupeId: detail ? detail.slice(0, 80) : "latest",
      title: "Agent Run Failed",
      body: detail || "An agent run failed — open the runs dock for details.",
      tag: "agent-run-failed",
    });
  }

  /** Test helper — reset agent-attention dedupe state. */
  resetAgentAttentionDedupe(): void {
    this.agentAttentionLastShown.clear();
  }

  // Cancel any pending reminders for a task (call on delete or completion).
  cancelTaskReminder(taskId: string): void {
    const handles = this.taskReminderHandles.get(taskId);
    if (handles) {
      handles.forEach((h) => {
        clearTimeout(h);
      });
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

    const leadMs = this.preferences.dueDateLeadMinutes * 60 * 1000;
    const handles: ReturnType<typeof setTimeout>[] = [];

    if (leadMs > 0) {
      const reminderTime = Math.max(timeUntilDue - leadMs, 0);
      const leadMinutes = this.preferences.dueDateLeadMinutes;
      const reminderBody =
        timeUntilDue <= leadMs
          ? `A task is due in ~${Math.max(1, Math.round(timeUntilDue / 60000))} minutes`
          : leadMinutes >= 60 && leadMinutes % 60 === 0
            ? `A task is due in ${leadMinutes / 60} hour${leadMinutes === 60 ? "" : "s"}`
            : `A task is due in ${leadMinutes} minutes`;

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
    }

    // Also remind at due time when lead is shorter than time until due
    if (timeUntilDue > leadMs) {
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

    if (handles.length > 0) {
      this.taskReminderHandles.set(taskId, handles);
    }
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
    tasks: NotificationTask[],
    options: NotificationCheckOptions = {},
  ): {
    overdue: NotificationTask[];
    dueSoon: NotificationTask[];
  } {
    const now = new Date();
    const leadMs = this.preferences.dueDateLeadMinutes * 60 * 1000;
    const dueSoonCutoff = new Date(now.getTime() + leadMs);
    const completedColumnIds = resolveCompletedColumnIds(options);

    const overdue: NotificationTask[] = [];
    const dueSoon: NotificationTask[] = [];

    tasks.forEach((task) => {
      if (!task.dueDate || isTaskComplete(task, completedColumnIds)) return;

      const dueDate = new Date(task.dueDate);

      if (dueDate < now) {
        overdue.push(task);
      } else if (dueDate <= dueSoonCutoff) {
        dueSoon.push(task);
      }
    });

    return { overdue, dueSoon };
  }

  // Show notification for overdue tasks
  notifyOverdue(tasks: Array<{ title: string }>): void {
    if (tasks.length === 0 || !this.preferences.overdueNudgesEnabled) return;

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
    getTasks: () => NotificationTask[],
    intervalMs: number = 60000,
    options: NotificationCheckOptions = {},
  ): void {
    if (this.checkIntervalId) {
      this.stopPeriodicCheck();
    }

    const check = () => {
      if (!this.preferences.overdueNudgesEnabled) return;

      const tasks = getTasks();
      const completedColumnIds = resolveCompletedColumnIds(options);
      const { overdue } = this.checkOverdueTasks(tasks, { completedColumnIds });

      const activeIds = new Set(
        tasks.filter((t) => !isTaskComplete(t, completedColumnIds)).map((t) => t.id),
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
