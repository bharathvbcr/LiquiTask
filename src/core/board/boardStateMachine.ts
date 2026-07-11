import { COLUMN_STATUS } from "../../constants";

/**
 * The git-aligned five-stage board state machine.
 *
 * The board is a strict state machine mirroring the git lifecycle of a task:
 *
 *   Task ──▶ InProgress ──▶ Completed ──▶ InReview ──▶ Commit
 *   (backlog)   (worktree)   (staged)      (PR open)    (merged; terminal)
 *
 * Reverse edges: InProgress → Task (abort), Completed/InReview → InProgress
 * (rework), Completed → Task (park). Commit is terminal — reopening requires
 * an explicit `reopen` flag (user-confirmed) and lands back in Task.
 *
 * Custom (user-created) columns are treated as parking lanes: they can trade
 * cards with Task/InProgress freely, but entry into Completed, InReview, and
 * Commit is always guarded by the canonical rules below.
 *
 * This module is PURE — no services, no IO. Every mutation path (drag & drop,
 * MCP tools, automation rules, agent lifecycle hooks) validates through
 * `validateTransition` before an event is appended to the task event log.
 */

export type CanonicalStatus =
  | typeof COLUMN_STATUS.TASK
  | typeof COLUMN_STATUS.IN_PROGRESS
  | typeof COLUMN_STATUS.COMPLETED
  | typeof COLUMN_STATUS.IN_REVIEW
  | typeof COLUMN_STATUS.COMMIT;

export const CANONICAL_STATUSES: CanonicalStatus[] = [
  COLUMN_STATUS.TASK,
  COLUMN_STATUS.IN_PROGRESS,
  COLUMN_STATUS.COMPLETED,
  COLUMN_STATUS.IN_REVIEW,
  COLUMN_STATUS.COMMIT,
];

export function isCanonicalStatus(id: string): id is CanonicalStatus {
  return (CANONICAL_STATUSES as string[]).includes(id);
}

/** Who is asking for the transition. Agents get a strictly smaller edge set. */
export type TransitionActor = "user" | "agent" | "automation" | "system";

export interface TransitionContext {
  actor: TransitionActor;
  /**
   * True when the Completed→Commit or InReview→Commit move is being executed
   * BY the transactional merge pipeline (verify → commit → merge → prune).
   */
  viaMergePipeline?: boolean;
  /** Local reviewer-agent stage (Completed → InReview without an open PR). */
  localReviewerGate?: boolean;
  /** The task has a finished agent run with an unmerged worktree/branch. */
  hasUnmergedWork?: boolean;
  /** An agent run is currently queued/running/verifying for this task. */
  hasActiveRun?: boolean;
  /** A pull request is open for this task (pushPr path). */
  hasPrOpen?: boolean;
  /** The linked PR has been merged on GitHub. */
  prMerged?: boolean;
  /** Unresolved `blocked-by` links (blockers not yet in Commit). */
  blockedByOpen?: boolean;
  /** Human-readable label of the first open blocker (for the denial reason). */
  blockedByLabel?: string;
  /** Target column would exceed its WIP limit. */
  wipExceeded?: boolean;
  /** Another run holds an overlapping file-scope reservation. */
  scopeReservationHeld?: boolean;
  /** Label for the scope holder (for denial copy). */
  scopeHeldByLabel?: string;
}

export interface TransitionVerdict {
  allowed: boolean;
  /** Denial reason, suitable for a toast / MCP error message. */
  reason?: string;
  /**
   * Set when the move is legal but must be executed by a side-effecting
   * pipeline instead of a plain status write:
   * - "merge-pipeline": run the transactional commit/merge pipeline; the card
   *   lands in Commit only if the merge succeeds.
   * - "agent-run": moving an agent-assigned card into InProgress should start
   *   (or attach to) a run + provision a worktree.
   */
  requires?: "merge-pipeline" | "agent-run" | "scope-release";
}

const allow = (requires?: TransitionVerdict["requires"]): TransitionVerdict => ({
  allowed: true,
  requires,
});
const deny = (reason: string): TransitionVerdict => ({ allowed: false, reason });

/** Canonical forward/reverse edges. Custom columns are handled separately. */
export const ALLOWED_TRANSITIONS: Record<CanonicalStatus, CanonicalStatus[]> = {
  [COLUMN_STATUS.TASK]: [COLUMN_STATUS.IN_PROGRESS],
  [COLUMN_STATUS.IN_PROGRESS]: [COLUMN_STATUS.COMPLETED, COLUMN_STATUS.TASK],
  [COLUMN_STATUS.COMPLETED]: [
    COLUMN_STATUS.IN_REVIEW,
    COLUMN_STATUS.COMMIT,
    COLUMN_STATUS.IN_PROGRESS,
    COLUMN_STATUS.TASK,
  ],
  [COLUMN_STATUS.IN_REVIEW]: [
    COLUMN_STATUS.COMMIT,
    COLUMN_STATUS.IN_PROGRESS,
    COLUMN_STATUS.COMPLETED,
  ],
  [COLUMN_STATUS.COMMIT]: [],
};

/**
 * Validate a status transition against the git-aligned state machine.
 *
 * Ordering of checks matters: structural rules (terminal column, skipping
 * stages) are reported before contextual ones (blockers, WIP) so denial
 * reasons stay stable regardless of board state.
 */
export function validateTransition(
  from: string,
  to: string,
  ctx: TransitionContext,
): TransitionVerdict {
  // Reorder within a column is always fine.
  if (from === to) return allow();

  const agent = ctx.actor === "agent";

  // ---- Terminal column ------------------------------------------------------
  if (from === COLUMN_STATUS.COMMIT) {
    if (ctx.reopen && to === COLUMN_STATUS.TASK && !agent) {
      return allow();
    }
    return deny(
      "Commit is terminal — the work is merged. Reopen explicitly or create a follow-up task.",
    );
  }

  // ---- Entering Commit ------------------------------------------------------
  if (to === COLUMN_STATUS.COMMIT) {
    if (agent) {
      return deny(
        "The Commit stage is human-gated. Finish with complete_task; a person reviews and merges.",
      );
    }
    if (from === COLUMN_STATUS.IN_REVIEW) {
      if (ctx.hasActiveRun) {
        return deny("An agent run is still active on this task — wait for it to finish.");
      }
      if (ctx.hasPrOpen && !ctx.prMerged && !ctx.viaMergePipeline) {
        return deny(
          "The pull request is not merged yet — wait for CI/review or use the merge pipeline.",
        );
      }
      if (ctx.hasUnmergedWork && !ctx.viaMergePipeline) {
        return { allowed: true, requires: "merge-pipeline" };
      }
      return allow();
    }
    if (from !== COLUMN_STATUS.COMPLETED) {
      return deny("Work must pass through Completed (review) before it can be committed.");
    }
    if (ctx.hasActiveRun) {
      return deny("An agent run is still active on this task — wait for it to finish.");
    }
    if (ctx.hasUnmergedWork && !ctx.viaMergePipeline) {
      return { allowed: true, requires: "merge-pipeline" };
    }
    return allow();
  }

  // ---- Entering In Review ---------------------------------------------------
  if (to === COLUMN_STATUS.IN_REVIEW) {
    if (agent) {
      return deny("Agents may not move cards into In Review — that stage is PR-driven.");
    }
    if (from === COLUMN_STATUS.TASK || from === COLUMN_STATUS.IN_PROGRESS) {
      return deny("Tasks can't skip straight to In Review — move through Completed first.");
    }
    if (from !== COLUMN_STATUS.COMPLETED) {
      return deny("Only completed work can enter In Review.");
    }
    if (ctx.actor === "system" && !ctx.hasPrOpen && !ctx.localReviewerGate) {
      return deny("In Review requires an open pull request.");
    }
    if (ctx.localReviewerGate || (ctx.actor === "system" && ctx.hasPrOpen)) {
      return allow();
    }
    return allow();
  }

  // ---- Entering Completed ---------------------------------------------------
  if (to === COLUMN_STATUS.COMPLETED) {
    if (from === COLUMN_STATUS.TASK) {
      return deny("Tasks can't skip straight to Completed — move through In Progress.");
    }
    if (agent && from !== COLUMN_STATUS.IN_PROGRESS) {
      return deny("Agents may only complete work that is In Progress.");
    }
    return allow();
  }

  // The system actor is the app's own run lifecycle (run started/finished
  // hooks) — it respects structural rules but skips advisory guards
  // (blockers/WIP), since the underlying run is already a fact.
  const system = ctx.actor === "system";

  // ---- Entering In Progress -------------------------------------------------
  if (to === COLUMN_STATUS.IN_PROGRESS) {
    if (!system && ctx.blockedByOpen) {
      return deny(
        ctx.blockedByLabel
          ? `Cannot start: Blocked by ${ctx.blockedByLabel}.`
          : "Cannot start: this task has unresolved blockers.",
      );
    }
    if (!system && ctx.wipExceeded) return deny("In Progress has reached its WIP limit.");
    if (!system && ctx.scopeReservationHeld) {
      return {
        allowed: true,
        requires: "scope-release",
        reason: ctx.scopeHeldByLabel
          ? `Scope overlap with ${ctx.scopeHeldByLabel} — wait for release or force dispatch.`
          : "Another run holds overlapping file scope — wait for release or force dispatch.",
      };
    }
    if (agent && from !== COLUMN_STATUS.TASK) {
      return deny("Agents may only pick up tasks from the backlog.");
    }
    return allow("agent-run");
  }

  // ---- Entering Task (backlog) or a custom column ---------------------------
  if (agent) {
    // Agents never park cards in backlog/custom lanes.
    return deny("Agents may only move their card forward (In Progress → Completed).");
  }
  if (!system && ctx.wipExceeded) return deny("That column has reached its WIP limit.");
  if (!system && to !== COLUMN_STATUS.TASK && ctx.blockedByOpen) {
    // Moving into a custom lane counts as "working" — blockers still apply.
    return deny(
      ctx.blockedByLabel
        ? `Cannot start: Blocked by ${ctx.blockedByLabel}.`
        : "Cannot start: this task has unresolved blockers.",
    );
  }
  return allow();
}

/** Map a validated transition to its task-event type (for the event log). */
export function transitionEventType(from: string, to: string): "task.moved" {
  void from;
  void to;
  return "task.moved";
}

/** One-line description used in activity trails and MCP tool responses. */
export function describeTransition(from: string, to: string): string {
  return `${from || "?"} → ${to || "?"}`;
}
