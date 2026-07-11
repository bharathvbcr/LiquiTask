import type { Task } from "../../../types";

/**
 * Task-domain events — the append-only source of truth for board state.
 *
 * LiquiTask is fully event-sourced for the task domain: every mutation is
 * recorded as an immutable event BEFORE any projection (React state, SQLite
 * snapshot, IndexedDB mirror, search index) is updated. On boot the board is
 * rebuilt by replaying the log; the legacy task stores are treated as derived
 * read models and can be regenerated at any time.
 *
 * Events are state-carrying: mutations embed the full serialized task rather
 * than a field-delta. This keeps replay deterministic (no patch-merge
 * semantics to version) at the cost of log size — an acceptable trade for a
 * local-first store. `changed` preserves the human-readable delta for audit.
 */

export const TASK_EVENT_SCHEMA_VERSION = 1 as const;

export type TaskEventType =
  /** Task created on the board (user, automation, MCP, or planner). */
  | "task.created"
  /** Pre-event-sourcing task adopted into the log (genesis migration). */
  | "task.imported"
  /** Any field mutation that is not a column move. */
  | "task.updated"
  /** Column (status) transition validated by the board state machine. */
  | "task.moved"
  /** PR opened after push+PR commit pipeline. */
  | "task.pr_opened"
  /** CI check-run rollup updated from GitHub polling. */
  | "task.ci_state"
  /** PR review decision / comment rollup updated from GitHub polling. */
  | "task.review_state"
  | "task.deleted"
  /** Agent lifecycle facts (audit trail; task state changes ride task.*). */
  | "run.started"
  | "run.finished"
  | "worktree.provisioned"
  | "worktree.merged"
  | "worktree.discarded"
  | "merge.failed"
  /** Dead-letter queue lifecycle. */
  | "action.dead-lettered"
  | "action.retried"
  | "action.discarded";

/** A serialized task as it appears inside event payloads (dates → ISO). */
export type SerializedTask = Record<string, unknown>;

export interface TaskEvent {
  /** Globally unique event id (`evt-…`). */
  id: string;
  /**
   * Monotonic sequence assigned by the store on append. Absent on drafts;
   * present on every event read back from the log.
   */
  seq?: number;
  /** Aggregate id — the task id, or "board" for board-level facts. */
  streamId: string;
  type: TaskEventType;
  payload: {
    /** Full task state after the event (task.* mutation events). */
    task?: SerializedTask;
    /** Field names that changed (audit; not used by replay). */
    changed?: string[];
    /** task.moved: source/target columns. */
    from?: string;
    to?: string;
    /** Free-form detail for run/worktree/merge/DLQ events. */
    [key: string]: unknown;
  };
  /** Who caused it: "user", "automation", "system", or "agent:<name>". */
  actor: string;
  /** Agent run this event belongs to, when applicable. */
  runId?: string;
  /** ISO-8601 timestamp. */
  ts: string;
  v: typeof TASK_EVENT_SCHEMA_VERSION;
}

/** An event under construction — id/ts/v filled by `draftEvent`. */
export type TaskEventDraft = Omit<TaskEvent, "id" | "ts" | "v" | "seq"> &
  Partial<Pick<TaskEvent, "id" | "ts">>;

let draftCounter = 0;

export function draftEvent(draft: TaskEventDraft): TaskEvent {
  draftCounter = (draftCounter + 1) % 0xffff;
  return {
    id:
      draft.id ??
      `evt-${Date.now().toString(36)}-${draftCounter.toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    streamId: draft.streamId,
    type: draft.type,
    payload: draft.payload ?? {},
    actor: draft.actor,
    runId: draft.runId,
    ts: draft.ts ?? new Date().toISOString(),
    v: TASK_EVENT_SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Task (de)serialization — events must round-trip through JSON/SQLite.
// ---------------------------------------------------------------------------

export function serializeTask(task: Task): SerializedTask {
  return JSON.parse(JSON.stringify(task)) as SerializedTask;
}

function reviveDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Revive a serialized task back into the runtime `Task` shape (ISO → Date). */
export function deserializeTask(raw: SerializedTask): Task {
  const task = { ...(raw as unknown as Task) };
  task.createdAt = reviveDate(raw.createdAt) ?? new Date(0);
  task.updatedAt = reviveDate(raw.updatedAt);
  task.dueDate = reviveDate(raw.dueDate);
  task.completedAt = reviveDate(raw.completedAt);
  if (task.recurring) {
    task.recurring = {
      ...task.recurring,
      endDate: reviveDate((raw.recurring as Record<string, unknown>)?.endDate),
      nextOccurrence: reviveDate((raw.recurring as Record<string, unknown>)?.nextOccurrence),
    };
  }
  task.activity = (task.activity ?? []).map((a) => ({
    ...a,
    timestamp: reviveDate(a.timestamp as unknown) ?? new Date(0),
  }));
  task.errorLogs = (task.errorLogs ?? []).map((e) => ({
    ...e,
    timestamp: reviveDate(e.timestamp as unknown) ?? new Date(0),
  }));
  task.subtasks = task.subtasks ?? [];
  task.attachments = task.attachments ?? [];
  task.tags = task.tags ?? [];
  task.timeEstimate = task.timeEstimate ?? 0;
  task.timeSpent = task.timeSpent ?? 0;
  return task;
}
