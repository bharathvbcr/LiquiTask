/**
 * TypeScript seam for the Phase 5 SQLite task-store cutover.
 *
 * Wraps the Rust `task_store_*` Tauri commands (`src-tauri/src/task_store.rs`,
 * backed by `tasks_export.sqlite3`) that persist tasks/projects/columns. This
 * is the single boundary the storage service uses to dual-write mutations and
 * to hydrate the board on boot when `FEATURE_FLAGS.TASKS_SQLITE_ENABLED` is on.
 *
 * Desktop (Tauri) only: on the web/PWA build every entry point is a no-op and
 * `isSqliteTaskStoreActive()` returns false, so IndexedDB stays the mirror.
 */

import { invoke } from "@tauri-apps/api/core";
import type { BoardColumn, Project, Task } from "../../types";
import { FEATURE_FLAGS } from "../constants";
import { normalizeTaskStrings } from "../migrations/normalizeTaskStrings";
import { isTauri } from "../runtime/runtimeEnvironment";
import { hydrateTaskRecord } from "./nativeBridge";

/** Rust `TaskRecord` i64 fields — must not be sent as floats (except `order`, which is f64). */
const TASK_I64_FIELDS = ["timeEstimate", "timeSpent"] as const;

/** Coerce fractional numeric fields to integers Rust accepts; preserve fractional `order`. */
function normalizeTaskWireScalars(task: Task): Task {
  const base = normalizeTaskStrings(task);
  const patch: Partial<Task> = {};

  for (const key of TASK_I64_FIELDS) {
    const val = base[key];
    if (typeof val === "number" && !Number.isInteger(val)) {
      patch[key] = Math.round(val);
    }
  }

  if (base.recurring) {
    const r = base.recurring;
    const needsFix =
      !Number.isInteger(r.interval) ||
      (r.dayOfMonth != null && !Number.isInteger(r.dayOfMonth)) ||
      r.daysOfWeek?.some((d) => !Number.isInteger(d));
    if (needsFix) {
      patch.recurring = {
        ...r,
        interval: Math.round(r.interval),
        dayOfMonth: r.dayOfMonth != null ? Math.round(r.dayOfMonth) : undefined,
        daysOfWeek: r.daysOfWeek?.map((d) => Math.round(d)),
      };
    }
  }

  if (base.githubIssue && !Number.isInteger(base.githubIssue.number)) {
    patch.githubIssue = {
      ...base.githubIssue,
      number: Math.round(base.githubIssue.number),
    };
  }

  return Object.keys(patch).length > 0 ? { ...base, ...patch } : base;
}

/** Wire shape returned by `task_store_read_snapshot` (camelCase, dates as ISO strings). */
interface RawSnapshot {
  tasks: Record<string, unknown>[];
  projects: Project[];
  columns: BoardColumn[];
}

export interface TaskStoreSnapshot {
  tasks: Task[];
  projects: Project[];
  columns: BoardColumn[];
}

/**
 * True when SQLite is the active task/project/column store: the feature flag
 * is on AND we are running under the Tauri desktop backend. Callers use this to
 * decide whether to dual-write / read from SQLite and whether to retire the
 * IndexedDB mirror.
 */
export function isSqliteTaskStoreActive(): boolean {
  return FEATURE_FLAGS.TASKS_SQLITE_ENABLED && isTauri();
}

/** Strip Date objects / undefined to a plain JSON payload the Rust wire types accept. */
function toWire<T>(items: T[]): Record<string, unknown>[] {
  return items.map((item) => JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
}

/**
 * Normalize task fields for Rust `TaskRecord` wire types (strict strings + i64/f64).
 */
function toTaskWire(tasks: Task[]): Record<string, unknown>[] {
  return tasks.map((task) => JSON.parse(JSON.stringify(normalizeTaskWireScalars(task))));
}

/**
 * Full-replacement dual-write. Only the entity lists provided are replaced in
 * SQLite (each atomically); omitting a list leaves that table untouched, so a
 * single-domain mutation (e.g. a task edit) never clobbers projects/columns.
 * No-op unless SQLite is the active store.
 */
export async function writeSqliteSnapshot(update: {
  tasks?: Task[];
  projects?: Project[];
  columns?: BoardColumn[];
}): Promise<void> {
  if (!isSqliteTaskStoreActive()) return;
  await invoke("task_store_write_snapshot", {
    tasks: update.tasks ? toTaskWire(update.tasks) : undefined,
    projects: update.projects ? toWire(update.projects) : undefined,
    columns: update.columns ? toWire(update.columns) : undefined,
  });
}

/**
 * Additive upsert used to seed SQLite during the one-time import (does not
 * delete rows absent from the input). No-op unless SQLite is the active store.
 */
export async function seedSqliteSnapshot(update: {
  tasks: Task[];
  projects: Project[];
  columns: BoardColumn[];
}): Promise<void> {
  if (!isSqliteTaskStoreActive()) return;
  await invoke("task_store_export_snapshot", {
    tasks: toTaskWire(update.tasks),
    projects: toWire(update.projects),
    columns: toWire(update.columns),
  });
}

/**
 * Read the full snapshot back from SQLite, hydrating task date fields into
 * `Date` objects. Returns null when SQLite is not the active store.
 */
export async function readSqliteSnapshot(): Promise<TaskStoreSnapshot | null> {
  if (!isSqliteTaskStoreActive()) return null;
  const raw = await invoke<RawSnapshot>("task_store_read_snapshot");
  return {
    tasks: raw.tasks.map((record) => hydrateTaskRecord(record)),
    projects: raw.projects ?? [],
    columns: raw.columns ?? [],
  };
}

export interface SqliteTaskCommitRequest {
  events: Array<{
    id: string;
    streamId: string;
    eventType: string;
    payload: string;
    actor: string;
    runId?: string | null;
    ts: string;
    v: number;
  }>;
  upsertTasks: Task[];
  deleteTaskIds: string[];
}

export interface SqliteTaskCommitResult {
  seqs: number[];
  tasksWritten: number;
  tasksDeleted: number;
}

/**
 * Atomic event-log append + task projection upsert/delete in SQLite.
 * No-op (returns null) unless SQLite is the active store.
 */
export async function commitSqliteTaskMutation(
  request: SqliteTaskCommitRequest,
): Promise<SqliteTaskCommitResult | null> {
  if (!isSqliteTaskStoreActive()) return null;
  return invoke<SqliteTaskCommitResult>("task_store_commit", {
    events: request.events,
    upsertTasks: toTaskWire(request.upsertTasks),
    deleteTaskIds: request.deleteTaskIds,
  });
}
