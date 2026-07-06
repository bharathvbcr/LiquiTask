import { COLUMN_STATUS } from "../../constants";
import type { AgentRun, Task } from "../../../types";

/** True while the agent process is paused, or an error mentions a permission/block. */
export function isBlockedRun(run: AgentRun): boolean {
  if (run.status === "failed" && run.verification && !run.verification.passed) return true;
  if (run.status === "running" && run.isPaused) return true;
  const err = (run.error ?? "").toLowerCase();
  return err.includes("permission") || err.includes("blocked");
}

/** Mirrors AgentRunsDock's `showReview` gating: finished run, task sitting in Review, no verdict yet. */
export function isAwaitingReview(run: AgentRun, task: Task | undefined): boolean {
  if (run.status !== "completed" || run.reviewOutcome) return false;
  return task?.status === COLUMN_STATUS.REVIEW;
}

export interface InboxCounts {
  /** Runs awaiting human review (approve/reject). */
  approvals: number;
  /** Runs paused, permission-blocked, or failed verification. */
  blocked: number;
  /** Total items that need the user's attention right now (approvals + blocked). */
  actionable: number;
}

/**
 * Counts-only summary of `agentRuns` against `tasks`, shared between InboxView (rendering)
 * and the app shell (tray badge / notifications) so the "what's actionable" definition
 * lives in exactly one place.
 */
export function deriveInboxCounts(agentRuns: AgentRun[], tasks: Task[]): InboxCounts {
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
  return { approvals, blocked, actionable: approvals + blocked };
}
