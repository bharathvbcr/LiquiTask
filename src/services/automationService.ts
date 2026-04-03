import type { Task } from "../../types";
import type { FilterGroup } from "../types/queryTypes";
import { executeAdvancedFilter } from "../utils/queryEngine";

export type AutomationTrigger = "onCreate" | "onUpdate" | "onMove" | "onComplete" | "onSchedule";
export type AutomationAction =
  | "setField"
  | "addTag"
  | "removeTag"
  | "moveToColumn"
  | "setPriority"
  | "notify";

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
    frequency: "daily" | "weekly" | "monthly";
    time: string; // HH:mm format
    dayOfWeek?: number; // 0-6, optional for weekly rules
    dayOfMonth?: number; // 1-31, optional for monthly rules
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
  private schedulerContext: {
    getAllTasks: () => Task[];
    applyTaskUpdates: (taskId: string, updates: Partial<Task>) => void;
    notify?: (message: string) => void;
  } | null = null;

  /**
   * Load rules from storage
   */
  loadRules(rules: AutomationRule[] | undefined | null): void {
    this.rules = Array.isArray(rules) ? rules : [];
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
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index !== -1) {
      this.rules[index] = { ...this.rules[index], ...updates };
      this.startScheduler();
    }
  }

  /**
   * Delete a rule
   */
  deleteRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    this.startScheduler();
  }

  /**
   * Configure task context for scheduled automation.
   */
  configureSchedulerContext(context: {
    getAllTasks: () => Task[];
    applyTaskUpdates: (taskId: string, updates: Partial<Task>) => void;
    notify?: (message: string) => void;
  }): void {
    this.schedulerContext = context;
    this.startScheduler();
  }

  /**
   * Clear scheduler context (typically on unmount).
   */
  clearSchedulerContext(): void {
    this.schedulerContext = null;
    this.stop();
  }

  /**
   * Process task event and execute matching rules
   */
  processTaskEvent(
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: {
      onNotify?: (message: string) => void;
    },
  ): Partial<Task> | null {
    const matchingRules = this.rules.filter(
      (rule) =>
        rule.enabled &&
        rule.trigger === event &&
        this.evaluateConditions(rule, context.newTask, allTasks),
    );

    if (matchingRules.length === 0) return null;

    // Apply all matching rule actions
    const updates: Partial<Task> = {};
    const tagsToAdd: string[] = [];
    const tagsToRemove: string[] = [];
    const notifications: string[] = [];
    const notify = options?.onNotify || this.schedulerContext?.notify;

    matchingRules.forEach((rule) => {
      rule.actions.forEach((action) => {
        switch (action.type) {
          case "setField":
            if (action.field) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (updates as any)[action.field] = action.value;
            }
            break;
          case "addTag":
            if (typeof action.value === "string") {
              tagsToAdd.push(action.value);
            }
            break;
          case "removeTag":
            if (typeof action.value === "string") {
              tagsToRemove.push(action.value);
            }
            break;
          case "moveToColumn":
            updates.status = action.value as string;
            break;
          case "setPriority":
            updates.priority = action.value as string;
            break;
          case "notify":
            if (typeof action.value === "string") {
              notifications.push(action.value);
            }
            break;
        }
      });
    });

    // Merge tag changes
    if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
      const currentTags = context.newTask.tags || [];
      const newTags = [
        ...currentTags.filter((t) => !tagsToRemove.includes(t)),
        ...tagsToAdd.filter((t) => !currentTags.includes(t)),
      ];
      updates.tags = newTags;
    }

    if (notifications.length > 0 && notify) {
      const deduped = Array.from(new Set(notifications.map((n) => n.trim()).filter(Boolean)));
      deduped.forEach((message) => notify(message));
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

  private isRuleDue(rule: AutomationRule, now: Date): boolean {
    if (!rule.schedule) return false;

    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    if (rule.schedule.time !== currentTime) {
      return false;
    }

    if (rule.schedule.frequency === "weekly" && typeof rule.schedule.dayOfWeek === "number") {
      return now.getDay() === rule.schedule.dayOfWeek;
    }

    if (rule.schedule.frequency === "monthly" && typeof rule.schedule.dayOfMonth === "number") {
      return now.getDate() === rule.schedule.dayOfMonth;
    }

    return true;
  }

  /**
   * Start scheduler for scheduled rules
   */
  private startScheduler(): void {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }

    const rules = Array.isArray(this.rules) ? this.rules : [];
    const hasScheduledRules = rules.some((r) => r.enabled && r.trigger === "onSchedule");
    if (!hasScheduledRules || !this.schedulerContext) return;

    // Check every minute for scheduled rules
    this.scheduleInterval = setInterval(() => {
      const now = new Date();
      const tasks = this.schedulerContext?.getAllTasks?.() || [];

      rules
        .filter((r) => r.enabled && r.trigger === "onSchedule" && r.schedule)
        .forEach((rule) => {
          if (!this.isRuleDue(rule, now)) {
            return;
          }

          tasks.forEach((task) => {
            const updates = this.processTaskEvent("onSchedule", { newTask: task }, tasks, {
              onNotify: this.schedulerContext?.notify,
            });
            if (updates) {
              this.schedulerContext?.applyTaskUpdates(task.id, updates);
            }
          });
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
