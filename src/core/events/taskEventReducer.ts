import type { Task, TaskPrState } from "../../../types";
import { deserializeTask, type TaskEvent } from "./taskEvents";

/**
 * Pure projection: fold the task event log into board state.
 *
 * Because mutation events are state-carrying (payload.task is the full task
 * after the event), the reducer is a deterministic replace/delete fold — no
 * patch semantics, no versioned merge rules. Non-mutation events (run.*,
 * worktree.*, merge.*, action.*) are audit facts and do not change the
 * projection.
 */

export type TaskProjection = Map<string, Task>;

function mergePrState(existing: TaskPrState | undefined, patch: TaskPrState): TaskPrState {
  return {
    ...existing,
    ...patch,
    ci: patch.ci ? { ...existing?.ci, ...patch.ci } : existing?.ci,
    review: patch.review ? { ...existing?.review, ...patch.review } : existing?.review,
    updatedAt: patch.updatedAt ?? existing?.updatedAt,
  };
}

function applyPrMetadataEvent(state: TaskProjection, event: TaskEvent): TaskProjection {
  const task = state.get(event.streamId);
  if (!task) return state;
  const patch = event.payload.prState as TaskPrState | undefined;
  if (!patch) return state;
  const next: Task = {
    ...task,
    prState: mergePrState(task.prState, patch),
    updatedAt: new Date(event.ts),
  };
  state.set(task.id, next);
  return state;
}

export function applyTaskEvent(state: TaskProjection, event: TaskEvent): TaskProjection {
  switch (event.type) {
    case "task.created":
    case "task.imported":
    case "task.updated":
    case "task.moved": {
      const raw = event.payload.task;
      if (!raw) return state;
      const task = deserializeTask(raw);
      if (!task.id) return state;
      state.set(task.id, task);
      return state;
    }
    case "task.pr_opened":
    case "task.ci_state":
    case "task.review_state":
      return applyPrMetadataEvent(state, event);
    case "task.deleted": {
      state.delete(event.streamId);
      return state;
    }
    default:
      return state;
  }
}

/** Replay a log (ordered by seq) on top of an optional snapshot base. */
export function replayTaskEvents(
  events: TaskEvent[],
  base?: Task[],
): Task[] {
  const state: TaskProjection = new Map((base ?? []).map((t) => [t.id, t]));
  for (const event of events) {
    applyTaskEvent(state, event);
  }
  return [...state.values()];
}

/**
 * Cheap integrity probe used at boot: compares the replayed projection with
 * the legacy snapshot and reports drift (ids only — the log wins on content).
 */
export function diffProjection(
  replayed: Task[],
  snapshot: Task[],
): { onlyInLog: string[]; onlyInSnapshot: string[] } {
  const logIds = new Set(replayed.map((t) => t.id));
  const snapIds = new Set(snapshot.map((t) => t.id));
  return {
    onlyInLog: [...logIds].filter((id) => !snapIds.has(id)),
    onlyInSnapshot: [...snapIds].filter((id) => !logIds.has(id)),
  };
}
