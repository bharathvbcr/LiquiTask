/**
 * Derived, presentation-only view of an agent run's progress and error state.
 *
 * The run pipeline has no first-class `progress` field (progress lives
 * implicitly in `status` + the streamed event log + subtask completion). These
 * pure helpers turn that implicit state into an explicit phase / percent /
 * label for a progress bar, and normalise the error into one readable line —
 * so both are trivial to render and unit-test.
 */
import type { AgentRun, AgentRunEvent } from "../../types";

export type RunPhase =
  | "queued"
  | "running"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunProgress {
  phase: RunPhase;
  /** 0–100 estimate suitable for a progress bar. */
  percent: number;
  /** Short human label, e.g. "Working", "Verifying", "Failed". */
  label: string;
  /** Whether the run is still doing work (drives spinner / bar animation). */
  active: boolean;
}

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

/**
 * Estimate run progress. Prefers real subtask completion when available,
 * otherwise falls back to a bounded function of streamed event volume so an
 * active run's bar still advances instead of sitting at 0.
 */
export function deriveRunProgress(
  run: Pick<AgentRun, "status" | "isPaused" | "events">,
  opts?: { subtasksTotal?: number; subtasksDone?: number },
): RunProgress {
  const total = opts?.subtasksTotal ?? 0;
  const done = clamp(opts?.subtasksDone ?? 0, 0, total || Infinity);

  switch (run.status) {
    case "queued":
      return { phase: "queued", percent: 5, label: "Queued", active: true };
    case "running": {
      let percent: number;
      if (total > 0) {
        // 15% for "picked up", the remaining 70% tracks subtask completion.
        percent = 15 + Math.round((done / total) * 70);
      } else {
        const events = run.events?.length ?? 0;
        percent = clamp(15 + events * 4, 15, 85);
      }
      return run.isPaused
        ? { phase: "paused", percent, label: "Paused", active: false }
        : { phase: "running", percent, label: "Working", active: true };
    }
    case "verifying":
      return { phase: "verifying", percent: 90, label: "Verifying", active: true };
    case "completed":
      return { phase: "completed", percent: 100, label: "Completed", active: false };
    case "failed":
      return { phase: "failed", percent: 100, label: "Failed", active: false };
    case "cancelled":
      return { phase: "cancelled", percent: 100, label: "Cancelled", active: false };
    default:
      return { phase: "queued", percent: 0, label: String(run.status), active: false };
  }
}

const ERROR_EVENT_KINDS: ReadonlyArray<AgentRunEvent["kind"]> = ["stderr", "result"];

/**
 * Best-effort single-line error summary for a run. Uses `run.error` when set,
 * otherwise falls back to the last stderr/result event, so a failure is never
 * shown as a bare "Failed" with no reason.
 */
export function formatRunError(
  run: Pick<AgentRun, "status" | "error" | "events">,
): string | undefined {
  if (run.status !== "failed") return undefined;
  const explicit = run.error?.trim();
  if (explicit) return firstLine(explicit);

  const events = run.events ?? [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (ERROR_EVENT_KINDS.includes(event.kind) && event.text.trim()) {
      return firstLine(event.text.trim());
    }
  }
  return "Run failed with no error detail.";
}

function firstLine(text: string, max = 200): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? text.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Status-pill / accent tone for a run, shared across the dock, inbox and run detail. */
export type RunStatusTone = "amber" | "red" | "emerald" | "slate" | "blue" | "purple";

/**
 * Map a run's status (and paused flag) to a single presentation tone so the
 * badge, the card's status spine, and the collapsed-pill counters all agree on
 * one colour language: blue = in progress, purple = verifying, amber = paused /
 * needs attention, emerald = done, red = failed, slate = queued / cancelled.
 */
export function runStatusTone(
  run: Pick<AgentRun, "status" | "isPaused">,
): RunStatusTone {
  if (run.isPaused) return "amber";
  switch (run.status) {
    case "running":
      return "blue";
    case "verifying":
      return "purple";
    case "completed":
      return "emerald";
    case "failed":
      return "red";
    default:
      return "slate";
  }
}

/**
 * Compact relative time ("just now", "4m ago", "2h ago", "3d ago") for run
 * timestamps. Shared so the dock and inbox read identically.
 */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
