/**
 * Render an agent run as a plain-text log for copy-to-clipboard / bug reports.
 * Pure and deterministic so it can be unit-tested and reused across the dock,
 * inbox, and run detail.
 */
import type { AgentRun } from "../../types";

const tsLabel = (ts: Date | string | number): string => {
  const d = ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString();
};

/** Full, copyable run log: header (task/run/status/branch/error) then events. */
export function formatRunLog(
  run: AgentRun,
  task?: { title?: string; jobId?: string },
): string {
  const lines: string[] = [];
  lines.push(`Task: ${task?.title ?? run.taskId}${task?.jobId ? ` (${task.jobId})` : ""}`);
  lines.push(`Run: ${run.id}`);
  lines.push(`Status: ${run.status}`);
  if (run.gitBranch) lines.push(`Branch: ${run.gitBranch}`);
  if (typeof run.costUsd === "number") lines.push(`Cost: $${run.costUsd.toFixed(2)}`);
  if (run.error) lines.push(`Error: ${run.error}`);
  lines.push("");
  if (run.events.length === 0) {
    lines.push("(no output)");
  } else {
    for (const event of run.events) {
      lines.push(`[${tsLabel(event.ts)}] ${event.kind}: ${event.text}`);
    }
  }
  return lines.join("\n").trimEnd();
}
