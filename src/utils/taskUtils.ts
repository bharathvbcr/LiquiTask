import type { BoardColumn } from "../../types";
import { COLUMN_STATUS } from "../constants";

/** Completed (review) or Commit (merged) — terminal for heuristics. */
export function isTerminalTaskStatus(status: string | undefined): boolean {
  return status === COLUMN_STATUS.COMPLETED || status === COLUMN_STATUS.COMMIT;
}

/** First non-completed column, or the first column, or the default Task status. */
export function getBacklogColumnId(columns: BoardColumn[]): string {
  const backlog = columns.find((c) => !c.isCompleted);
  return backlog?.id ?? columns[0]?.id ?? COLUMN_STATUS.TASK;
}

/** Column ids marked as completed (tasks here should not trigger due/overdue alerts). */
export function getCompletedColumnIds(columns: BoardColumn[]): Set<string> {
  return new Set(columns.filter((c) => c.isCompleted).map((c) => c.id));
}

export function isTaskComplete(
  task: { status?: string; completedAt?: Date },
  completedColumnIds: Set<string>,
): boolean {
  if (task.completedAt) return true;
  return Boolean(task.status && completedColumnIds.has(task.status));
}

/** Collision-resistant task id for rapid or bulk creation. */
export function generateTaskId(suffix?: string | number): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return suffix !== undefined ? `task-${unique}-${suffix}` : `task-${unique}`;
}
