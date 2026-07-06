import type { AgentProfile, AgentRun, Task } from "../../../types";
import type { AgentPermissionRequest } from "./agentMcpService";

export interface StandupRunEntry {
  runId: string;
  taskId: string;
  taskTitle: string;
  agentName: string;
  status: AgentRun["status"];
  summary?: string;
  costUsd?: number;
  durationMinutes?: number;
  finishedAt?: Date;
}

export interface AgentStandupDigest {
  since: Date;
  until: Date;
  completed: StandupRunEntry[];
  failed: StandupRunEntry[];
  blocked: StandupRunEntry[];
  totalCostUsd: number;
  pendingPermissions: number;
  activeRuns: number;
}

export interface StandupDigestOptions {
  since?: Date;
  /** Window length when `since` is omitted (default 12). */
  hours?: number;
}

/** Default window: since yesterday 6:00 local, or last N hours — whichever is earlier (more recent). */
export function defaultStandupSince(hours = 12, now = new Date()): Date {
  const hoursAgo = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const yesterdaySix = new Date(now);
  yesterdaySix.setDate(yesterdaySix.getDate() - 1);
  yesterdaySix.setHours(6, 0, 0, 0);

  return hoursAgo > yesterdaySix ? hoursAgo : yesterdaySix;
}

function runFinishedInWindow(run: AgentRun, since: Date, until: Date): boolean {
  const ts = run.finishedAt ?? run.createdAt;
  return ts >= since && ts <= until;
}

function runActiveInWindow(run: AgentRun, since: Date, until: Date): boolean {
  if (run.status === "queued" || run.status === "running" || run.status === "verifying") {
    return (run.startedAt ?? run.createdAt) <= until;
  }
  return runFinishedInWindow(run, since, until);
}

function durationMinutes(run: AgentRun): number | undefined {
  if (!run.startedAt || !run.finishedAt) return undefined;
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  return ms > 0 ? Math.round(ms / 60_000) : undefined;
}

function toEntry(
  run: AgentRun,
  tasks: Task[],
  agents: AgentProfile[],
): StandupRunEntry {
  const task = tasks.find((t) => t.id === run.taskId);
  const agent = agents.find((a) => a.id === run.agentId);
  return {
    runId: run.id,
    taskId: run.taskId,
    taskTitle: task?.title ?? run.taskId,
    agentName: agent?.name ?? "Agent",
    status: run.status,
    summary: run.summary,
    costUsd: run.costUsd,
    durationMinutes: durationMinutes(run),
    finishedAt: run.finishedAt,
  };
}

function isBlockedRun(run: AgentRun): boolean {
  if (run.status === "failed" && run.verification && !run.verification.passed) {
    return true;
  }
  if (run.status === "running" && run.isPaused) return true;
  const err = (run.error ?? "").toLowerCase();
  return err.includes("permission") || err.includes("blocked");
}

export function buildAgentStandupDigest(
  runs: AgentRun[],
  tasks: Task[],
  agents: AgentProfile[],
  pendingPermissions: AgentPermissionRequest[],
  options: StandupDigestOptions = {},
): AgentStandupDigest {
  const until = new Date();
  const since = options.since ?? defaultStandupSince(options.hours ?? 12, until);

  const inWindow = runs.filter((r) => runActiveInWindow(r, since, until));
  const finishedInWindow = inWindow.filter(
    (r) =>
      (r.status === "completed" || r.status === "failed" || r.status === "cancelled") &&
      runFinishedInWindow(r, since, until),
  );

  const completed = finishedInWindow
    .filter((r) => r.status === "completed")
    .map((r) => toEntry(r, tasks, agents));

  const failed = finishedInWindow
    .filter((r) => r.status === "failed" && !isBlockedRun(r))
    .map((r) => toEntry(r, tasks, agents));

  const blocked = finishedInWindow
    .filter((r) => isBlockedRun(r))
    .map((r) => toEntry(r, tasks, agents));

  const activeRuns = runs.filter(
    (r) => r.status === "queued" || r.status === "running" || r.status === "verifying",
  ).length;

  const totalCostUsd = finishedInWindow.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  return {
    since,
    until,
    completed,
    failed,
    blocked,
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    pendingPermissions: pendingPermissions.length,
    activeRuns,
  };
}

export function formatStandupDigestText(digest: AgentStandupDigest): string {
  const lines: string[] = [
    "Agent standup",
    `${digest.completed.length} completed · ${digest.failed.length} failed · ${digest.blocked.length} blocked`,
    `$${digest.totalCostUsd.toFixed(2)} spent · ${digest.activeRuns} active · ${digest.pendingPermissions} pending permissions`,
  ];
  if (digest.completed.length) {
    lines.push("", "Completed:");
    for (const e of digest.completed.slice(0, 8)) {
      lines.push(`• ${e.taskTitle} (${e.agentName})`);
    }
  }
  if (digest.blocked.length || digest.failed.length) {
    lines.push("", "Needs attention:");
    for (const e of [...digest.blocked, ...digest.failed].slice(0, 6)) {
      lines.push(`• ${e.taskTitle} — ${e.status}`);
    }
  }
  return lines.join("\n");
}
