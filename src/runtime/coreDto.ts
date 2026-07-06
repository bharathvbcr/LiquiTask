/**
 * DTO converters for the native `liquitask-core` Rust crate.
 *
 * Boundary rule: the Rust core works entirely in **epoch milliseconds**. These
 * helpers convert the renderer's `Date`-bearing models into JSON-safe DTOs
 * (dates -> numbers) before `invoke`, and back on the way out. Keeping this in
 * one place means every migrated service serializes tasks identically.
 */
import type { RecurringConfig, Task } from "../../types";

/** `Date | string | number | undefined` -> epoch millis (or `undefined`). */
export const dateToMs = (d: Date | string | number | undefined | null): number | undefined => {
  if (d === undefined || d === null) return undefined;
  if (typeof d === "number") return d;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? undefined : t;
};

/** Epoch millis -> `Date` (or `undefined`). */
export const msToDate = (ms: number | null | undefined): Date | undefined =>
  ms === null || ms === undefined ? undefined : new Date(ms);

/** Recurrence config DTO with date fields as epoch millis. */
export interface CoreRecurringConfig {
  enabled: boolean;
  frequency: string;
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endDate?: number;
  nextOccurrence?: number;
}

export const toCoreRecurring = (c: RecurringConfig): CoreRecurringConfig => ({
  enabled: c.enabled,
  frequency: c.frequency,
  interval: c.interval,
  daysOfWeek: c.daysOfWeek,
  dayOfMonth: c.dayOfMonth,
  endDate: dateToMs(c.endDate),
  nextOccurrence: dateToMs(c.nextOccurrence),
});

/**
 * Task DTO consumed by the Rust core (see `liquitask-core::model::Task`). Dates
 * are epoch millis; only the fields the ported services read are included.
 */
export interface CoreTask {
  id: string;
  jobId: string;
  projectId: string;
  title: string;
  subtitle?: string;
  summary: string;
  assignee: string;
  priority: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
  dueDate?: number;
  completedAt?: number;
  subtasks: Array<{ id: string; title: string; completed: boolean }>;
  tags: string[];
  timeEstimate: number;
  timeSpent: number;
  links?: Array<{ targetTaskId: string; type: string }>;
  activity?: unknown[];
  recurring?: CoreRecurringConfig;
}

export const toCoreTask = (t: Task): CoreTask => ({
  id: t.id,
  jobId: t.jobId,
  projectId: t.projectId,
  title: t.title,
  subtitle: t.subtitle,
  summary: t.summary,
  assignee: t.assignee,
  priority: t.priority,
  status: t.status,
  createdAt: dateToMs(t.createdAt) ?? 0,
  updatedAt: dateToMs(t.updatedAt),
  dueDate: dateToMs(t.dueDate),
  completedAt: dateToMs(t.completedAt),
  subtasks: (t.subtasks ?? []).map((s) => ({ id: s.id, title: s.title, completed: s.completed })),
  tags: t.tags ?? [],
  timeEstimate: t.timeEstimate ?? 0,
  timeSpent: t.timeSpent ?? 0,
  links: t.links?.map((l) => ({ targetTaskId: l.targetTaskId, type: l.type })),
  activity: t.activity,
  recurring: t.recurring ? toCoreRecurring(t.recurring) : undefined,
});
