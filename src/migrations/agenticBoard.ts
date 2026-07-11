/**
 * Migration v1.0.0 → v1.1.0 — the agentic five-stage board.
 *
 * Reframes the default kanban columns from
 *   Pending / In Progress / Completed / Review / Delivered
 * to the agent-native lifecycle
 *   Task / In Progress / Completed / In Review / Commit
 *
 * Mapping (applied to stored columns, task statuses, and saved-view filters):
 *   Pending    → Task        (backlog)
 *   InProgress → InProgress  (unchanged id)
 *   Review     → Completed   (agent finished, awaiting human review/commit)
 *   Completed  → Commit      (old terminal column → new terminal column)
 *   Delivered  → Commit      (merged into the terminal column)
 *
 * User-created custom columns are preserved (appended after the canonical
 * columns in their original relative order). In Review is injected hidden
 * for existing boards via ensureAgenticColumns on boot.
 */

import type { BoardColumn, MigratableAppData, SavedView, Task } from "../../types";
import { DEFAULT_COLUMNS, LEGACY_COLUMN_MIGRATION } from "../constants";

const CANONICAL_IDS = new Set<string>(DEFAULT_COLUMNS.map((c) => c.id));

function mapStatus(status: string | undefined): string | undefined {
  if (!status) return status;
  return LEGACY_COLUMN_MIGRATION[status] ?? status;
}

export function migrateColumnsToAgenticBoard(
  columns: BoardColumn[] | undefined,
): BoardColumn[] | undefined {
  if (!Array.isArray(columns) || columns.length === 0) return columns;
  const custom = columns.filter(
    (c) => !(c.id in LEGACY_COLUMN_MIGRATION) && !CANONICAL_IDS.has(c.id),
  );
  return [...DEFAULT_COLUMNS.map((c) => ({ ...c }) as BoardColumn), ...custom];
}

export function migrateV1_0_to_V1_1_AgenticBoard(
  data: MigratableAppData,
): MigratableAppData {
  const tasks: Task[] | undefined = data.tasks?.map((task) => {
    const next = mapStatus(task.status);
    return next !== task.status ? { ...task, status: next ?? task.status } : task;
  });

  const savedViews: SavedView[] | undefined = data.savedViews?.map((view) => {
    const next = mapStatus(view.filters?.status);
    if (next === view.filters?.status) return view;
    return { ...view, filters: { ...view.filters, status: next } };
  });

  return {
    ...data,
    columns: migrateColumnsToAgenticBoard(data.columns),
    ...(tasks ? { tasks } : {}),
    ...(savedViews ? { savedViews } : {}),
    version: "1.1.0",
  };
}
