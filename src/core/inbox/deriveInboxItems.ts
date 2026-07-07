import { COLUMN_STATUS } from "../../constants";
import type { AgentRun, Task } from "../../../types";

/** True while the agent process is paused, or an error mentions a permission/block. */
export function isBlockedRun(run: AgentRun): boolean {
  if (run.status === "failed" && run.verification && !run.verification.passed) return true;
  if (run.status === "running" && run.isPaused) return true;
  const err = (run.error ?? "").toLowerCase();
  return err.includes("permission") || err.includes("blocked");
}

/** Mirrors AgentRunsDock's gating: finished run, task sitting in Completed awaiting commit, no verdict yet. */
export function isAwaitingReview(run: AgentRun, task: Task | undefined): boolean {
  if (run.status !== "completed" || run.reviewOutcome) return false;
  return task?.status === COLUMN_STATUS.COMPLETED;
}

export interface InboxCounts {
  /** Runs awaiting human review (approve/reject). */
  approvals: number;
  /** Runs paused, permission-blocked, or failed verification. */
  blocked: number;
  /** DevCouncil plans awaiting the plan-gate decision (Rework Plan §3.4 item 1). */
  plans: number;
  /** Dead-lettered actions (failed merges / agent actions) awaiting retry/discard. */
  deadLetters: number;
  /** Total items that need the user's attention right now. */
  actionable: number;
}

/**
 * Counts-only summary of `agentRuns` against `tasks`, shared between InboxView (rendering)
 * and the app shell (tray badge / notifications) so the "what's actionable" definition
 * lives in exactly one place.
 *
 * `pendingPlanCount` is passed as a number (agentPlannerService's pending-plan
 * store lives in services/) so this module stays a pure core dependency with
 * no service imports. Defaults to 0 to keep pre-plan-gate call sites valid.
 */
export function deriveInboxCounts(
  agentRuns: AgentRun[],
  tasks: Task[],
  pendingPlanCount = 0,
  deadLetterCount = 0,
): InboxCounts {
  const taskById = new Map<string, Task>();
  for (const task of tasks) taskById.set(task.id, task);

  let approvals = 0;
  let blocked = 0;
  for (const run of agentRuns) {
    const task = taskById.get(run.taskId);
    if (isAwaitingReview(run, task)) {
      approvals++;
      continue;
    }
    if (isBlockedRun(run)) blocked++;
  }
  return {
    approvals,
    blocked,
    plans: pendingPlanCount,
    deadLetters: deadLetterCount,
    actionable: approvals + blocked + pendingPlanCount + deadLetterCount,
  };
}

/**
 * Format DevCouncil blocking gaps into the feedback a repair run is seeded
 * with (`agentRunService.rejectWithFeedback`). Numbered so the agent can
 * address each gap individually; kept here (not inline in InboxView) so the
 * wording is testable and shared with any future repair entry points.
 */
export function formatRepairFeedback(gaps: string[]): string {
  const list = gaps.map((gap, i) => `${i + 1}. ${gap}`).join("\n");
  return [
    `DevCouncil verification failed with ${gaps.length} blocking gap(s). Fix each gap, then re-run the project's checks:`,
    list,
  ].join("\n");
}
