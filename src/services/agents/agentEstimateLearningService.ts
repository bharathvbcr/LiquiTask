import type { AgentRun, Task } from "../../../types";
import agentRunService from "./agentRunService";

export interface EstimateCalibration {
  sampleCount: number;
  avgActualMinutes: number;
  avgEstimatedMinutes: number;
  /** actual / estimate — values > 1 mean tasks took longer than estimated */
  ratio: number;
}

export interface EstimateSuggestion {
  minutes: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  calibration?: EstimateCalibration;
}

export function runDurationMinutes(run: AgentRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  // Count active runtime only — paused time isn't work, and including it would
  // teach the estimator that agents are slower than they are.
  const ms = run.finishedAt.getTime() - run.startedAt.getTime() - (run.pausedMs ?? 0);
  if (ms <= 0) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Compare task estimates against finished agent run durations. */
export function computeEstimateCalibration(
  tasks: Task[],
  runs: AgentRun[],
): EstimateCalibration {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const pairs: { estimate: number; actual: number }[] = [];

  for (const run of runs) {
    if (run.status !== "completed" && run.status !== "failed") continue;
    const actual = runDurationMinutes(run);
    if (actual == null) continue;
    const task = taskById.get(run.taskId);
    if (!task || task.timeEstimate <= 0) continue;
    pairs.push({ estimate: task.timeEstimate, actual });
  }

  if (!pairs.length) {
    return { sampleCount: 0, avgActualMinutes: 0, avgEstimatedMinutes: 0, ratio: 1 };
  }

  const avgActualMinutes =
    pairs.reduce((s, p) => s + p.actual, 0) / pairs.length;
  const avgEstimatedMinutes =
    pairs.reduce((s, p) => s + p.estimate, 0) / pairs.length;
  const ratio = avgEstimatedMinutes > 0 ? avgActualMinutes / avgEstimatedMinutes : 1;

  return {
    sampleCount: pairs.length,
    avgActualMinutes: Math.round(avgActualMinutes),
    avgEstimatedMinutes: Math.round(avgEstimatedMinutes),
    ratio: Math.round(ratio * 100) / 100,
  };
}

function similarTaskActuals(
  task: Pick<Task, "priority" | "tags" | "assignee">,
  tasks: Task[],
  runs: AgentRun[],
): number[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const tagSet = new Set(task.tags ?? []);
  const actuals: number[] = [];

  for (const run of runs) {
    if (run.status !== "completed") continue;
    const actual = runDurationMinutes(run);
    if (actual == null) continue;
    const src = taskById.get(run.taskId);
    if (!src) continue;

    const priorityMatch = src.priority === task.priority;
    const assigneeMatch = task.assignee && src.assignee === task.assignee;
    const tagOverlap = (src.tags ?? []).some((t) => tagSet.has(t));

    if (priorityMatch || assigneeMatch || tagOverlap) {
      actuals.push(actual);
    }
  }

  return actuals;
}

/**
 * Suggest a calibrated time estimate (minutes) from agent run history.
 * Uses similar completed runs, then global calibration, then raw averages.
 */
export function suggestCalibratedEstimate(
  task: Pick<Task, "title" | "priority" | "tags" | "assignee" | "timeEstimate">,
  tasks: Task[],
  runs: AgentRun[],
): EstimateSuggestion | null {
  const calibration = computeEstimateCalibration(tasks, runs);
  const similar = similarTaskActuals(task, tasks, runs);

  if (similar.length >= 2) {
    const minutes = median(similar);
    return {
      minutes,
      confidence: similar.length >= 5 ? "high" : "medium",
      reason: `Based on ${similar.length} similar agent runs (${task.priority} priority)`,
      calibration,
    };
  }

  const finished = runs.filter(
    (r) => (r.status === "completed" || r.status === "failed") && runDurationMinutes(r) != null,
  );
  if (finished.length >= 3) {
    const globalActuals = finished
      .map(runDurationMinutes)
      .filter((v): v is number => v != null);
    let minutes = median(globalActuals);

    if (calibration.sampleCount >= 3 && calibration.ratio > 0) {
      minutes = Math.max(5, Math.round(minutes));
    }

    return {
      minutes,
      confidence: "low",
      reason: `Based on ${finished.length} agent runs overall`,
      calibration,
    };
  }

  if (calibration.sampleCount >= 2 && task.timeEstimate > 0 && calibration.ratio !== 1) {
    const minutes = Math.max(
      5,
      Math.round(task.timeEstimate * calibration.ratio / 5) * 5,
    );
    return {
      minutes,
      confidence: "low",
      reason: `Adjusted by historical estimate accuracy (${Math.round(calibration.ratio * 100)}%)`,
      calibration,
    };
  }

  return null;
}

export function formatEstimateHint(
  suggestion: EstimateSuggestion,
  currentMinutes: number,
): string {
  if (currentMinutes > 0 && Math.abs(currentMinutes - suggestion.minutes) <= 5) {
    return `Estimate aligns with agent history (~${suggestion.minutes}m)`;
  }
  return `Agents typically take ~${suggestion.minutes}m — ${suggestion.reason.toLowerCase()}`;
}

export interface RunOutcomeRecord {
  outcome: "approved" | "rejected";
  feedback?: string;
}

/**
 * Persist a human review outcome on the agent run so estimate learning can read it.
 * Call on approve (records actual duration) and reject (records feedback).
 */
export function recordRunOutcome(run: AgentRun, record: RunOutcomeRecord): void {
  const actualMinutes = runDurationMinutes(run) ?? undefined;
  agentRunService.recordReviewOutcome(run.id, {
    outcome: record.outcome,
    feedback: record.feedback,
    actualMinutes: record.outcome === "approved" ? actualMinutes : undefined,
  });
}
