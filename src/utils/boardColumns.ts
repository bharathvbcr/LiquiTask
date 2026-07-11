import type { BoardColumn, Task } from "../../types";
import { COLUMN_STATUS } from "../constants";

/**
 * Columns visible on the board. Hidden canonical columns (e.g. In Review) are
 * omitted until at least one task occupies them — simple-mode users see no change.
 */
export function visibleBoardColumns(columns: BoardColumn[], tasks: Task[]): BoardColumn[] {
  const occupied = new Set(tasks.map((t) => t.status));
  return columns.filter((col) => {
    if (!col.hidden) return true;
    if (occupied.has(col.id)) return true;
    // Always show In Review when any task has prState (metadata without move yet).
    if (col.id === COLUMN_STATUS.IN_REVIEW) {
      return tasks.some((t) => Boolean(t.prState?.url || t.prState?.state));
    }
    return false;
  });
}

/** Unhide a column in persisted config when a task enters it. */
export function unhideColumn(columns: BoardColumn[], columnId: string): BoardColumn[] {
  return columns.map((col) =>
    col.id === columnId && col.hidden ? { ...col, hidden: false } : col,
  );
}
