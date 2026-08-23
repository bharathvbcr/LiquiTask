import { COLUMN_STATUS } from "../../constants";
import { isAwaitingReview, isBlockedRun } from "../inbox/deriveInboxItems";
import type { AgentRun, Task } from "../../../types";
import type { AgentPermissionRequest } from "../../services/agents/agentMcpService";

/** Why a task landed in the derived attention lane. */
export type AttentionReason =
  | "pending-permission"
  | "stalled-stream"
  | "blocker-reported"
  | "verify-failed"
  | "merge-conflict"
  | "needs-approval"
  | "dead-letter";

export interface AttentionItem {
  taskId: string;
  task?: Task;
  runId?: string;
  reasons: AttentionReason[];
  /** Short human label for the board filter chip. */
  label: string;
}

export interface AttentionLaneInput {
  tasks: Task[];
  runs: AgentRun[];
  pendingPermissions: AgentPermissionRequest[];
  /** Task ids with open dead letters. */
  deadLetterTaskIds?: Set<string>;
  /** Run ids flagged as stalled by the run-limit watchdog. */
  stalledRunIds?: Set<string>;
}

function taskHasOpenBlockers(task: Task, allTasks: Task[]): boolean {
  const links = task.links?.filter((l) => l.type === "blocked-by") ?? [];
  for (const link of links) {
    const blocker = allTasks.find((t) => t.id === link.targetTaskId);
    if (!blocker) continue;
    if (blocker.status !== COLUMN_STATUS.COMMIT) return true;
  }
  return false;
}

function runHasMergeConflict(run: AgentRun): boolean {
  const err = (run.error ?? "").toLowerCase();
  return err.includes("conflict") || err.includes("merge");
}

function deriveRunAttentionReasons(
  run: AgentRun,
  task: Task | undefined,
  allTasks: Task[],
  pendingPermissions: AgentPermissionRequest[],
  stalledRunIds: Set<string>,
): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  if (pendingPermissions.some((p) => p.taskId === run.taskId)) {
    reasons.push("pending-permission");
  }

  if (stalledRunIds.has(run.id) || run.failureKind === "stall") {
    reasons.push("stalled-stream");
  }

  if (run.status === "failed" && run.verification && !run.verification.passed) {
    reasons.push("verify-failed");
  }

  if (runHasMergeConflict(run)) {
    reasons.push("merge-conflict");
  }

  if (task && taskHasOpenBlockers(task, allTasks)) {
    reasons.push("blocker-reported");
  }

  if (isAwaitingReview(run, task)) {
    reasons.push("needs-approval");
  }

  if (isBlockedRun(run) && !reasons.includes("verify-failed") && !reasons.includes("pending-permission")) {
    reasons.push("stalled-stream");
  }

  return reasons;
}

function reasonLabel(reasons: AttentionReason[]): string {
  if (reasons.includes("pending-permission")) return "Permission pending";
  if (reasons.includes("needs-approval")) return "Awaiting approval";
  if (reasons.includes("verify-failed")) return "Verify failed";
  if (reasons.includes("merge-conflict")) return "Merge conflict";
  if (reasons.includes("blocker-reported")) return "Blocked";
  if (reasons.includes("stalled-stream")) return "Stalled";
  if (reasons.includes("dead-letter")) return "Failed action";
  return "Needs attention";
}

/**
 * Derived attention lane — NOT a canonical board state.
 * One-glance human queue from run/MCP/DLQ signals (Refactor 2 / STR-3).
 */
export function deriveAttentionLane(input: AttentionLaneInput): AttentionItem[] {
  const {
    tasks,
    runs,
    pendingPermissions,
    deadLetterTaskIds,
    stalledRunIds = new Set<string>(),
  } = input;

  const taskById = new Map<string, Task>();
  for (const task of tasks) taskById.set(task.id, task);

  const byTask = new Map<string, AttentionItem>();

  const ensure = (taskId: string): AttentionItem => {
    let item = byTask.get(taskId);
    if (!item) {
      item = {
        taskId,
        task: taskById.get(taskId),
        reasons: [],
        label: "Needs attention",
      };
      byTask.set(taskId, item);
    }
    return item;
  };

  for (const run of runs) {
    const task = taskById.get(run.taskId);
    const reasons = deriveRunAttentionReasons(
      run,
      task,
      tasks,
      pendingPermissions,
      stalledRunIds,
    );
    if (reasons.length === 0) continue;
    const item = ensure(run.taskId);
    item.runId = run.id;
    for (const r of reasons) {
      if (!item.reasons.includes(r)) item.reasons.push(r);
    }
    item.label = reasonLabel(item.reasons);
  }

  for (const perm of pendingPermissions) {
    const item = ensure(perm.taskId);
    if (!item.reasons.includes("pending-permission")) {
      item.reasons.push("pending-permission");
    }
    item.label = reasonLabel(item.reasons);
  }

  if (deadLetterTaskIds) {
    for (const taskId of deadLetterTaskIds) {
      const item = ensure(taskId);
      if (!item.reasons.includes("dead-letter")) {
        item.reasons.push("dead-letter");
      }
      item.label = reasonLabel(item.reasons);
    }
  }

  for (const task of tasks) {
    if (!taskHasOpenBlockers(task, tasks)) continue;
    const item = ensure(task.id);
    if (!item.reasons.includes("blocker-reported")) {
      item.reasons.push("blocker-reported");
    }
    item.label = reasonLabel(item.reasons);
  }

  return [...byTask.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

/** Task ids that should appear when the board "Needs Attention" filter is active. */
export function attentionTaskIdSet(input: AttentionLaneInput): Set<string> {
  return new Set(deriveAttentionLane(input).map((i) => i.taskId));
}
