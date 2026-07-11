/**
 * Pure run-guardrail policy: decide when an in-flight run has breached its
 * wall-clock timeout or gone silent (stalled), and whether a finished run blew
 * its per-run cost cap.
 *
 * Kept free of the run service so it's deterministic and unit-testable; the
 * service just polls {@link evaluateRunLimits} on a watchdog and enforces the
 * verdict. Cost is only known at the *end* of a run (the runtime reports it on
 * the final result line), so it can't preempt spend — it's a post-run flag.
 */
import type { AgentProfile, AgentRun } from "../../../types";

export interface RunLimits {
  /** Max wall-clock ms before a run is force-stopped. 0 = unlimited. */
  timeoutMs: number;
  /** Max ms with no new output before a run is treated as stalled. 0 = off. */
  stallMs: number;
  /** Per-run USD ceiling; flags overspend after the fact. 0 = off. */
  perRunCostCapUsd: number;
}

export interface RunLimitDefaults {
  timeoutMinutes?: number;
  stallMinutes?: number;
  perRunCostCapUsd?: number;
}

const minutesToMs = (minutes: number | undefined): number =>
  typeof minutes === "number" && minutes > 0 ? Math.round(minutes * 60_000) : 0;

/** Wall-clock timeout forwarded to agentd `run.start` (0 = unlimited). */
export function agentdStartTimeoutMs(
  agent: Pick<AgentProfile, "runTimeoutMinutes">,
  defaults: RunLimitDefaults = {},
): number {
  return resolveRunLimits(agent, defaults).timeoutMs;
}

/** Resolve effective limits: the agent's own settings win over the defaults. */
export function resolveRunLimits(
  agent: Pick<AgentProfile, "runTimeoutMinutes" | "stallTimeoutMinutes" | "perRunCostCapUsd">,
  defaults: RunLimitDefaults = {},
): RunLimits {
  return {
    timeoutMs: minutesToMs(agent.runTimeoutMinutes ?? defaults.timeoutMinutes),
    stallMs: minutesToMs(agent.stallTimeoutMinutes ?? defaults.stallMinutes),
    perRunCostCapUsd: Math.max(0, agent.perRunCostCapUsd ?? defaults.perRunCostCapUsd ?? 0),
  };
}

export type RunAbortReason = "timeout" | "stall";

export interface RunLimitVerdict {
  reason: RunAbortReason;
  message: string;
}

const minutesLabel = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? "" : "s"}`;
};

/**
 * Decide whether an active run has breached a live guardrail. Only running /
 * verifying, non-paused runs are eligible. Returns `null` when within limits.
 */
export function evaluateRunLimits(
  run: Pick<AgentRun, "status" | "isPaused" | "startedAt" | "events" | "pausedMs">,
  limits: RunLimits,
  nowMs: number,
): RunLimitVerdict | null {
  if (run.status !== "running" && run.status !== "verifying") return null;
  if (run.isPaused) return null;

  const startedMs = run.startedAt ? run.startedAt.getTime() : undefined;

  if (limits.timeoutMs > 0 && startedMs !== undefined) {
    // Exclude time the run spent paused — only *active* runtime counts toward
    // the timeout, so pausing overnight doesn't trip it on resume.
    const activeMs = nowMs - startedMs - (run.pausedMs ?? 0);
    if (activeMs > limits.timeoutMs) {
      return {
        reason: "timeout",
        message: `Run exceeded its ${minutesLabel(limits.timeoutMs)} time limit and was stopped.`,
      };
    }
  }

  if (limits.stallMs > 0) {
    const lastEvent = run.events.length > 0 ? run.events[run.events.length - 1] : undefined;
    const lastActivityMs = lastEvent ? lastEvent.ts.getTime() : startedMs;
    if (lastActivityMs !== undefined && nowMs - lastActivityMs > limits.stallMs) {
      return {
        reason: "stall",
        message: `Run produced no output for ${minutesLabel(limits.stallMs)} and was treated as stalled.`,
      };
    }
  }

  return null;
}

/** True when a finished run's cost exceeded the per-run cap (post-run flag). */
export function exceededCostCap(
  run: Pick<AgentRun, "costUsd">,
  limits: Pick<RunLimits, "perRunCostCapUsd">,
): boolean {
  return (
    limits.perRunCostCapUsd > 0 &&
    typeof run.costUsd === "number" &&
    run.costUsd > limits.perRunCostCapUsd
  );
}
