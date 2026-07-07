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

/**
 * Short badge label for *why* a run stopped, when it wasn't a plain error —
 * so the reason (crashed / timed out / stalled) shows at a glance on a run card
 * without opening the log. Returns `undefined` for normal runs.
 */
export function failureKindLabel(kind: AgentRun["failureKind"]): string | undefined {
  switch (kind) {
    case "crashed":
      return "Crashed";
    case "timeout":
      return "Timed out";
    case "stall":
      return "Stalled";
    default:
      return undefined;
  }
}

/** Last meaningful streamed output line (stderr/result), for diagnosis. */
function lastOutputLine(events: AgentRunEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (ERROR_EVENT_KINDS.includes(event.kind) && event.text.trim()) {
      return firstLine(event.text.trim());
    }
  }
  return undefined;
}

/** Common POSIX signal numbers → names, for decoding a `128 + signal` code. */
const SIGNAL_NAMES: Record<number, string> = {
  2: "SIGINT",
  6: "SIGABRT",
  9: "SIGKILL",
  11: "SIGSEGV",
  15: "SIGTERM",
};

/**
 * Turn a process exit code into a diagnosable, human message — and append the
 * last streamed output so a failure explains itself.
 *
 * The runner reports `-1` (or a missing code) when a process is *terminated*
 * rather than exiting normally: killed by a signal, an out-of-memory reap, a
 * timeout, a cancel, or a re-adopted process that vanished. Surfacing that as
 * "exited with code -1" is misleading; this says what actually happened. When
 * the native side encodes a Unix signal as `128 + signal`, it's decoded here.
 */
export function describeProcessExit(
  code: number | null | undefined,
  run?: Pick<AgentRun, "events">,
): string {
  const detail = lastOutputLine(run?.events ?? []);
  let base: string;
  if (code == null || code < 0) {
    base =
      "The agent process was terminated before it finished — no exit code. This usually means it was killed (out of memory, a timeout, or cancelled).";
  } else if (code === 0) {
    base = "The agent process exited cleanly.";
  } else if (code > 128 && code < 193) {
    const signal = code - 128;
    const name = SIGNAL_NAMES[signal];
    const label = name ? `${name} (${signal})` : `signal ${signal}`;
    const hint =
      signal === 9
        ? " — often the out-of-memory killer"
        : signal === 15 || signal === 2
          ? " — terminated (timeout or cancel)"
          : "";
    base = `The agent process was killed by ${label}${hint}.`;
  } else {
    base = `The agent process exited with code ${code}.`;
  }
  return detail ? `${base} Last output: ${detail}` : base;
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
