import type { RecurringConfig, Task } from "../../types";
import { callNative, isTauri } from "../runtime/runtimeEnvironment";
import { toCoreRecurring } from "../runtime/coreDto";
import { isNativeBackend, nativeCalculateNextOccurrence } from "./nativeBridge";
import { generateTaskId } from "../utils/taskUtils";

export interface RecurringTaskServiceOptions {
  onCreateTask: (task: Task) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  /** Returns the backlog / first-open column id for new recurring instances. */
  getDefaultStatus?: () => string;
  /** When a recurring instance is assigned to an agent, trigger a run. */
  onAgentRecurringTask?: (task: Task) => void;
}

/**
 * Service for managing recurring task generation
 */
export class RecurringTaskService {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private onCreateTask: (task: Task) => void;
  private onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  private getDefaultStatus: () => string;
  private onAgentRecurringTask?: (task: Task) => void;

  constructor(options: RecurringTaskServiceOptions) {
    this.onCreateTask = options.onCreateTask;
    this.onUpdateTask = options.onUpdateTask;
    this.getDefaultStatus = options.getDefaultStatus ?? (() => "Task");
    this.onAgentRecurringTask = options.onAgentRecurringTask;
  }

  /**
   * Start the recurring task scheduler
   * Checks every 5 minutes for tasks that need to be generated.
   * Accepts a live getter so the scheduler always operates on the current
   * task list rather than a stale snapshot captured at startup.
   */
  start(getTasks: () => Task[]): void {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;

    // Check immediately on start
    void this.checkAndGenerate(getTasks());

    // Then check every 5 minutes, fetching the live task list each time
    this.checkInterval = setInterval(
      () => {
        void this.checkAndGenerate(getTasks());
      },
      5 * 60 * 1000,
    ); // 5 minutes
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
  private async checkAndGenerate(tasks: Task[]): Promise<void> {
    const now = new Date();

    for (const originalTask of tasks) {
      if (!originalTask.recurring?.enabled) continue;
      if (!originalTask.recurring.nextOccurrence) continue;

      const nextOccurrence = new Date(originalTask.recurring.nextOccurrence);

      if (now >= nextOccurrence) {
        await this.generateRecurringInstance(originalTask);
      }
    }
  }

  /**
   * Generate a new instance of a recurring task
   */
  private async generateRecurringInstance(originalTask: Task): Promise<void> {
    if (!originalTask.recurring) return;

    const now = new Date();
    const nextOcc = await this.calculateNextOccurrenceNative(originalTask.recurring, now);
    const newTask: Task = {
      ...originalTask,
      id: generateTaskId(),
      jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
      createdAt: now,
      updatedAt: now,
      status: this.getDefaultStatus(),
      completedAt: undefined,
      recurring: {
        ...originalTask.recurring,
        nextOccurrence: nextOcc,
      },
      activity: [
        {
          id: `act-${Date.now()}`,
          type: "create",
          timestamp: now,
          userId: "system",
          details: `Recurring task instance generated from ${originalTask.jobId}`,
        },
      ],
    };

    this.onCreateTask(newTask);
    if (newTask.assignee?.trim()) {
      this.onAgentRecurringTask?.(newTask);
    }

    const advance = await this.advanceRecurring(originalTask.recurring, now);
    this.onUpdateTask(originalTask.id, {
      recurring: {
        ...originalTask.recurring,
        nextOccurrence: advance.nextOccurrence,
        enabled: advance.enabled,
      },
    });
  }

  private async advanceRecurring(
    config: RecurringConfig,
    now: Date = new Date(),
  ): Promise<{ nextOccurrence?: Date; enabled: boolean }> {
    const jsFallback = () => {
      const nextOccurrence = this.calculateNextOccurrence(config, now);
      const endDate = config.endDate ? new Date(config.endDate) : null;
      const pastEnd = endDate !== null && nextOccurrence > endDate;
      return {
        nextOccurrence: pastEnd ? undefined : nextOccurrence.getTime(),
        enabled: pastEnd ? false : config.enabled,
      };
    };

    const result = await callNative<{ nextOccurrence?: number; enabled: boolean }>(
      "recurring_advance",
      { config: toCoreRecurring(config), nowMs: now.getTime() },
      jsFallback,
    );

    return {
      nextOccurrence:
        result.nextOccurrence != null ? new Date(result.nextOccurrence) : undefined,
      enabled: result.enabled,
    };
  }

  /**
   * Calculate the next occurrence date based on recurrence configuration
   */
  calculateNextOccurrence(config: RecurringConfig, fromDate: Date = new Date()): Date {
    const next = new Date(fromDate);

    switch (config.frequency) {
      case "daily":
        next.setDate(next.getDate() + config.interval);
        break;

      case "weekly":
        if (config.daysOfWeek && config.daysOfWeek.length > 0) {
          // Find next matching day of week
          const currentDay = next.getDay();
          const sortedDays = [...config.daysOfWeek].sort((a, b) => a - b);

          // Find next day this week
          const nextDayThisWeek = sortedDays.find((day) => day > currentDay);
          if (nextDayThisWeek !== undefined) {
            next.setDate(next.getDate() + (nextDayThisWeek - currentDay) + (config.interval - 1) * 7);
          } else {
            // Next occurrence is in a future week; apply the full interval so
            // e.g. "every 2 weeks on Monday" skips the intermediate week(s).
            const daysUntilNext = 7 - currentDay + sortedDays[0];
            next.setDate(next.getDate() + daysUntilNext + (config.interval - 1) * 7);
          }
        } else {
          // Default: same day of week, every N weeks
          next.setDate(next.getDate() + 7 * config.interval);
        }
        break;

      case "monthly":
        if (config.dayOfMonth) {
          // Set to 1st first to avoid overflow when changing month
          next.setDate(1);
          // Move to next month(s)
          next.setMonth(next.getMonth() + config.interval);
          // Get the target month
          const targetMonth = next.getMonth();
          // Set to specific day of month
          next.setDate(config.dayOfMonth);

          // If date rolled over to next month (e.g., Feb 30 -> March 2)
          if (next.getMonth() !== targetMonth) {
            next.setDate(0); // Set to last day of target month
          }
        } else {
          // Same day of month, N months later
          next.setMonth(next.getMonth() + config.interval);
        }
        break;

      case "custom":
        // For custom, use interval as days (can be enhanced later)
        next.setDate(next.getDate() + config.interval);
        break;
    }

    return next;
  }

  /**
   * Rust-backed next-occurrence computation for the desktop build. Delegates to
   * the `liquitask-core` crate via the `recurring_next_occurrence` Tauri command
   * and falls back to the identical synchronous JS implementation on the
   * web/PWA build (proven equivalent by the differential oracle). Kept async
   * because Tauri `invoke` is async; the legacy sync method above is retained
   * for the existing synchronous call sites and web fallback.
   */
  async calculateNextOccurrenceNative(
    config: RecurringConfig,
    fromDate: Date = new Date(),
  ): Promise<Date> {
    if (isTauri()) {
      return callNative<number>(
        "recurring_next_occurrence",
        { config: toCoreRecurring(config), fromMs: fromDate.getTime() },
        () => this.calculateNextOccurrence(config, fromDate).getTime(),
      ).then((millis) => new Date(millis));
    }

    if (isNativeBackend()) {
      try {
        return await nativeCalculateNextOccurrence(config, fromDate);
      } catch (err) {
        console.warn("[recurring] native calculate failed; falling back to JS:", err);
      }
    }
    return this.calculateNextOccurrence(config, fromDate);
  }

  /**
   * Manually trigger generation for a specific task (for testing or manual triggers)
   */
  generateNow(task: Task): void {
    if (!task.recurring?.enabled) return;
    void this.generateRecurringInstance(task);
  }

  /**
   * Update nextOccurrence for a task (useful when task is completed)
   */
  async updateNextOccurrence(task: Task): Promise<void> {
    if (!task.recurring?.enabled) return;

    const advance = await this.advanceRecurring(task.recurring);
    this.onUpdateTask(task.id, {
      recurring: {
        ...task.recurring,
        nextOccurrence: advance.nextOccurrence,
        enabled: advance.enabled,
      },
    });
  }
}

// Singleton instance (will be initialized in App.tsx)
let _recurringTaskService: RecurringTaskService | null = null;

export function initializeRecurringTaskService(
  options: RecurringTaskServiceOptions,
): RecurringTaskService {
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
  start: (getTasks: () => Task[]) => _recurringTaskService?.start(getTasks),
  stop: () => _recurringTaskService?.stop(),
  calculateNextOccurrence: (config: RecurringConfig, fromDate?: Date) =>
    _recurringTaskService?.calculateNextOccurrence(config, fromDate),
  calculateNextOccurrenceNative: (config: RecurringConfig, fromDate?: Date) =>
    _recurringTaskService?.calculateNextOccurrenceNative(config, fromDate),
  updateNextOccurrence: (task: Task) => _recurringTaskService?.updateNextOccurrence(task),
};
