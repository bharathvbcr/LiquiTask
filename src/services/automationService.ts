import type { BoardColumn, Task } from "../../types";
import type { FilterGroup } from "../types/queryTypes";
import { executeAdvancedFilter } from "../utils/queryEngine";
import { callNative, isTauri } from "../runtime/runtimeEnvironment";
import { toCoreTask } from "../runtime/coreDto";

export type AutomationTrigger = "onCreate" | "onUpdate" | "onMove" | "onComplete" | "onSchedule";
export type AutomationAction =
  | "setField"
  | "addTag"
  | "removeTag"
  | "moveToColumn"
  | "setPriority"
  | "notify"
  | "assignToAgent";

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions?: FilterGroup; // Optional filter conditions
  actions: Array<
    | { type: "addTag" | "removeTag" | "notify"; value: string }
    | { type: "moveToColumn" | "setPriority" | "assignToAgent"; value: string }
    | { type: "setField"; field: string; value: unknown }
  >;
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

/**
 * Explicit allowlist of task fields that automation rules are permitted to mutate.
 * Internal/integrity fields (id, projectId, createdAt, completedAt, activity,
 * errorLogs, etc.) are intentionally excluded to prevent corruption by
 * user-defined or AI-generated automation rules.
 */
const MUTABLE_TASK_FIELDS = new Set<string>([
  "assignee",
  "summary",
  "title",
  "subtitle",
  "timeEstimate",
  "dueDate",
]);

/**
 * Deterministic output of reducing a set of matched rules over a task. Mirrors
 * the Rust `ApplyResult` struct returned by `automation_apply_actions`; the JS
 * `applyMatchedRules` below produces the identical shape so the sync and native
 * code paths are behaviourally interchangeable (proven by the differential
 * oracle).
 */
interface ApplyResult {
  updates: Record<string, unknown>;
  tags?: string[];
  notifications: string[];
  assignToAgentIds: string[];
  hasUpdates: boolean;
}

/**
 * Pure action reducer — the deterministic core shared by the synchronous
 * `processTaskEvent` (web fallback + source of truth for sync call sites) and
 * the async `processTaskEventNative` (which delegates this computation to Rust).
 * Given the ALREADY-MATCHED rules and the target task, compute the update
 * payload, merged tags, deduped notify messages and unique agent ids. No side
 * effects, no clock, and no condition evaluation (that stays in the caller).
 */
function applyMatchedRules(matchingRules: AutomationRule[], task: Task): ApplyResult {
  const updates: Record<string, unknown> = {};
  const tagsToAdd: string[] = [];
  const tagsToRemove: string[] = [];
  const notifications: string[] = [];
  const assignToAgentIds: string[] = [];

  matchingRules.forEach((rule) => {
    rule.actions.forEach((action) => {
      switch (action.type) {
        case "setField":
          if (action.field && MUTABLE_TASK_FIELDS.has(action.field)) {
            updates[action.field] = action.value;
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
          if (typeof action.value === "string") {
            updates.status = action.value;
          }
          break;
        case "setPriority":
          if (typeof action.value === "string") {
            updates.priority = action.value;
          }
          break;
        case "notify":
          if (typeof action.value === "string") {
            notifications.push(action.value);
          }
          break;
        case "assignToAgent":
          if (typeof action.value === "string") {
            assignToAgentIds.push(action.value);
          }
          break;
      }
    });
  });

  // Merge tag changes (only when an add/remove action fired).
  let mergedTags: string[] | undefined;
  if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
    const currentTags = task.tags || [];
    const newTags = [
      ...currentTags.filter((t) => !tagsToRemove.includes(t)),
      ...tagsToAdd.filter((t) => !currentTags.includes(t)),
    ];
    updates.tags = newTags;
    mergedTags = newTags;
  }

  const dedupedNotifications = Array.from(
    new Set(notifications.map((n) => n.trim()).filter(Boolean)),
  );
  const uniqueAgentIds = Array.from(new Set(assignToAgentIds));

  return {
    updates,
    tags: mergedTags,
    notifications: dedupedNotifications,
    assignToAgentIds: uniqueAgentIds,
    hasUpdates: Object.keys(updates).length > 0,
  };
}

export class AutomationService {
  private rules: AutomationRule[] = [];
  private scheduleInterval: NodeJS.Timeout | null = null;
  private schedulerContext: {
    getAllTasks: () => Task[];
    applyTaskUpdates: (taskId: string, updates: Partial<Task>) => void;
    notify?: (message: string) => void;
    getColumns?: () => BoardColumn[];
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
    getColumns?: () => BoardColumn[];
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
   * Filter the loaded rules down to those matching `event` for `task`: enabled,
   * correct trigger, and passing condition evaluation. Condition evaluation (the
   * query engine, `executeAdvancedFilter`) intentionally stays in TypeScript —
   * it is NOT ported to Rust — so both the sync and native paths share this
   * exact filter and only the already-matched rules ever reach the reducer.
   */
  private matchRules(event: AutomationTrigger, task: Task, allTasks: Task[]): AutomationRule[] {
    return this.rules.filter(
      (rule) =>
        rule.enabled && rule.trigger === event && this.evaluateConditions(rule, task, allTasks),
    );
  }

  /**
   * Process a task event and compute the resulting updates **synchronously**.
   *
   * This is the source of truth for the renderer's synchronous call sites
   * (`useTaskController`) and the web/PWA fallback. It matches rules, reduces
   * their actions in pure JS, fires the notify / assign callbacks, and returns
   * the `Partial<Task>` update payload (or `null`). The Rust-backed equivalent
   * is `processTaskEventNative`; both are proven equivalent by the oracle.
   */
  processTaskEvent(
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: {
      onNotify?: (message: string) => void;
      onAssignToAgent?: (taskId: string, agentId: string) => void;
      columns?: BoardColumn[];
    },
  ): Partial<Task> | null {
    const matchingRules = this.matchRules(event, context.newTask, allTasks);
    if (matchingRules.length === 0) return null;

    const result = applyMatchedRules(matchingRules, context.newTask);
    this.dispatchSideEffects(result, context.newTask, options);

    return result.hasUpdates ? (result.updates as Partial<Task>) : null;
  }

  /**
   * Rust-backed equivalent of `processTaskEvent` for the desktop build.
   *
   * Matching (trigger + enabled + CONDITION evaluation) stays in TypeScript;
   * only the already-matched rules' action reduction is delegated to the
   * `automation_apply_actions` Tauri command. The notify / assign callbacks are
   * still fired here in TS. Falls back to the identical synchronous JS reducer
   * on the web/PWA build or if the native call throws. Kept async because Tauri
   * `invoke` is async; the sync `processTaskEvent` above remains for the
   * existing synchronous call sites.
   */
  async processTaskEventNative(
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: {
      onNotify?: (message: string) => void;
      onAssignToAgent?: (taskId: string, agentId: string) => void;
      columns?: BoardColumn[];
    },
  ): Promise<Partial<Task> | null> {
    const matchingRules = this.matchRules(event, context.newTask, allTasks);
    if (matchingRules.length === 0) return null;

    const result = await callNative<ApplyResult>(
      "automation_apply_actions",
      { rules: matchingRules, task: toCoreTask(context.newTask) },
      () => applyMatchedRules(matchingRules, context.newTask),
    );

    this.dispatchSideEffects(result, context.newTask, options);

    return result.hasUpdates ? (result.updates as Partial<Task>) : null;
  }

  /**
   * Fire the notify / assign side effects for a reduced result. Shared by the
   * sync and native paths so callback behaviour is identical. The result's
   * notifications and agent ids are already deduped/trimmed by the reducer
   * (JS or Rust), so this just dispatches them.
   */
  private dispatchSideEffects(
    result: ApplyResult,
    task: Task,
    options?: {
      onNotify?: (message: string) => void;
      onAssignToAgent?: (taskId: string, agentId: string) => void;
    },
  ): void {
    const notify = options?.onNotify || this.schedulerContext?.notify;
    const onAssignToAgent = options?.onAssignToAgent;

    if (result.notifications.length > 0 && notify) {
      result.notifications.forEach((message) => {
        notify(message);
      });
    }

    if (result.assignToAgentIds.length > 0 && onAssignToAgent) {
      result.assignToAgentIds.forEach((agentId) => {
        onAssignToAgent(task.id, agentId);
      });
    }
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
   * Rust-backed schedule due-check for the desktop build. Delegates to the
   * `automation_is_rule_due` command (UTC civil math over epoch millis) and
   * falls back to the synchronous JS `isRuleDue` on web / on error. The private
   * `isRuleDue` above is retained for the synchronous scheduler tick and as the
   * web fallback.
   */
  private async isRuleDueNative(rule: AutomationRule, now: Date): Promise<boolean> {
    return callNative<boolean>("automation_is_rule_due", { rule, nowMs: now.getTime() }, () =>
      this.isRuleDue(rule, now),
    );
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
      const columns = this.schedulerContext?.getColumns?.();

      const scheduledRules = rules.filter(
        (r) => r.enabled && r.trigger === "onSchedule" && r.schedule,
      );

      // On the desktop build, run the whole tick through the Rust-backed
      // `automation_is_rule_due` + `automation_apply_actions` path; on the
      // web/PWA build stay fully synchronous with the identical JS logic. Both
      // apply updates through the same `applyTaskUpdates` callback.
      if (isTauri()) {
        void (async () => {
          for (const rule of scheduledRules) {
            if (!(await this.isRuleDueNative(rule, now))) {
              continue;
            }
            for (const task of tasks) {
              const updates = await this.processTaskEventNative(
                "onSchedule",
                { newTask: task },
                tasks,
                { onNotify: this.schedulerContext?.notify, columns },
              );
              if (updates) {
                this.schedulerContext?.applyTaskUpdates(task.id, updates);
              }
            }
          }
        })();
        return;
      }

      scheduledRules.forEach((rule) => {
        if (!this.isRuleDue(rule, now)) {
          return;
        }

        tasks.forEach((task) => {
          const updates = this.processTaskEvent("onSchedule", { newTask: task }, tasks, {
            onNotify: this.schedulerContext?.notify,
            columns,
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
