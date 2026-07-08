/**
 * v1.1.0 → v1.2.0 migration: normalize task string fields at the source.
 *
 * Earlier builds could persist tasks whose `title` / `summary` / `subtitle` /
 * `tags` / `subtasks[].title` were objects or undefined rather than strings
 * (AI-generated `{ title }` shapes, mostly). Every consumer now coerces on read,
 * but that leaves the bad data in place — this rewrites it once so it renders
 * and compares cleanly everywhere.
 */
import type { MigratableAppData, Task } from "../../types";
import { asString, asStringArray } from "../utils/coerce";

/**
 * Coerce a task's string-ish fields to strings. Only *malformed* fields are
 * touched — a fully-valid task is returned by reference so the migration is a
 * no-op for clean data (no churn, stable identities).
 */
export function normalizeTaskStrings(task: Task): Task {
  const patch: Partial<Task> = {};

  if (typeof task.title !== "string") patch.title = asString(task.title);
  if (typeof task.summary !== "string") patch.summary = asString(task.summary);
  if (task.subtitle != null && typeof task.subtitle !== "string") {
    patch.subtitle = asString(task.subtitle);
  }
  if (Array.isArray(task.tags) && task.tags.some((t) => typeof t !== "string")) {
    patch.tags = asStringArray(task.tags);
  }
  if ((task.subtasks ?? []).some((s) => typeof s?.title !== "string")) {
    patch.subtasks = (task.subtasks ?? []).map((s) =>
      typeof s?.title === "string" ? s : { ...s, title: asString(s?.title) },
    );
  }

  return Object.keys(patch).length > 0 ? { ...task, ...patch } : task;
}

export function migrateV1_1_to_V1_2_NormalizeTaskStrings(
  data: MigratableAppData,
): MigratableAppData {
  const tasks: Task[] | undefined = data.tasks?.map(normalizeTaskStrings);
  return {
    ...data,
    ...(tasks ? { tasks } : {}),
    version: "1.2.0",
  };
}
