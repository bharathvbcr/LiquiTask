/**
 * Autopilots — recurring agent automations, derived rather than stored.
 *
 * An autopilot is not a new persisted entity: it is the pairing of a recurring
 * board task (the schedule) with the agent it routes to via `Task.assignee`
 * (the executor), provided that agent opts into recurrence runs. Deriving the
 * list on demand keeps `agentRecurrence.ts` + `recurringTaskService` the single
 * source of truth for *whether/when* runs fire; this module only describes the
 * automations so views can render them.
 */
import { shouldRunAgentOnRecurrence } from "../../services/agents/agentRecurrence";
import { isBlockedRun } from "../inbox/deriveInboxItems";
import type { AgentProfile, AgentRun, RecurringConfig, Task } from "../../../types";

/** Condensed view of the executing agent's most recent run. */
export interface AutopilotLastRun {
  status: AgentRun["status"];
  finishedAt?: Date;
}

/** One recurring automation: a recurring task scheduled onto an agent. */
export interface Autopilot {
  id: string;
  agentId: string;
  agentName: string;
  /** The recurring source task whose schedule drives this automation. */
  taskId: string;
  taskTitle: string;
  /** Human-readable cadence, e.g. "Weekly on Mon, Fri". */
  cadenceLabel: string;
  /** Next scheduled firing (the source task's `recurring.nextOccurrence`). */
  nextRunAt?: Date;
  lastRun?: AutopilotLastRun;
  /** False when the agent's latest run failed or is blocked — surfaced so views can warn before the next firing. */
  healthy: boolean;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Render a RecurringConfig as a short cadence label. Presentation-only — the
 * actual next-occurrence math stays in `recurringTaskService` (Rust-backed);
 * duplicating it here would risk the label and the scheduler disagreeing.
 */
export function describeCadence(config: RecurringConfig): string {
  const interval = Number.isFinite(config.interval) ? Math.max(1, Math.floor(config.interval)) : 1;
  switch (config.frequency) {
    case "daily":
      return interval === 1 ? "Daily" : `Every ${interval} days`;
    case "weekly": {
      const base = interval === 1 ? "Weekly" : `Every ${interval} weeks`;
      const days = (config.daysOfWeek ?? [])
        .filter((day) => day >= 0 && day <= 6)
        .sort((a, b) => a - b)
        .map((day) => DAY_LABELS[day]);
      return days.length > 0 ? `${base} on ${days.join(", ")}` : base;
    }
    case "monthly": {
      const base = interval === 1 ? "Monthly" : `Every ${interval} months`;
      return config.dayOfMonth ? `${base} on day ${config.dayOfMonth}` : base;
    }
    case "custom":
      // `custom` intervals are day-based (see recurringTaskService.calculateNextOccurrence).
      return interval === 1 ? "Daily" : `Every ${interval} days`;
    default:
      return "Recurring";
  }
}

/** Persisted dates may round-trip through storage as strings; normalize defensively. */
function asDate(value: Date | string | undefined): Date | undefined {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function runSortKey(run: AgentRun): number {
  return (
    asDate(run.finishedAt)?.getTime() ??
    asDate(run.startedAt)?.getTime() ??
    asDate(run.createdAt)?.getTime() ??
    0
  );
}

/**
 * Latest run per agent. Recurring instances are materialised with fresh task
 * ids (see recurringTaskService.generateRecurringInstance), so runs can't be
 * traced back to the recurring *source* task — the agent's own run history is
 * the closest available health signal for its automations.
 */
function latestRunByAgent(runs: AgentRun[]): Map<string, AgentRun> {
  const latest = new Map<string, AgentRun>();
  for (const run of runs) {
    const current = latest.get(run.agentId);
    if (!current || runSortKey(run) >= runSortKey(current)) {
      latest.set(run.agentId, run);
    }
  }
  return latest;
}

/**
 * Describe every recurring automation on the board: each enabled recurring
 * task assigned to an agent that runs on recurrence becomes one Autopilot.
 * Tasks assigned to humans (or to agents that opted out) are excluded — they
 * recur, but nothing runs automatically.
 */
export function deriveAutopilots(
  agents: AgentProfile[],
  tasks: Task[],
  runs: AgentRun[],
): Autopilot[] {
  // Task.assignee routes by agent *name* (see AgentProfile.name doc).
  const agentByName = new Map<string, AgentProfile>();
  for (const agent of agents) {
    agentByName.set(agent.name.trim().toLowerCase(), agent);
  }

  const latestRuns = latestRunByAgent(runs);
  const autopilots: Autopilot[] = [];

  for (const task of tasks) {
    if (!task.recurring?.enabled) continue;
    const agent = agentByName.get((task.assignee ?? "").trim().toLowerCase());
    if (!agent || !shouldRunAgentOnRecurrence(agent)) continue;

    const last = latestRuns.get(agent.id);
    autopilots.push({
      id: `autopilot:${agent.id}:${task.id}`,
      agentId: agent.id,
      agentName: agent.name,
      taskId: task.id,
      taskTitle: task.title,
      cadenceLabel: describeCadence(task.recurring),
      nextRunAt: asDate(task.recurring.nextOccurrence),
      lastRun: last ? { status: last.status, finishedAt: asDate(last.finishedAt) } : undefined,
      // No history yet counts as healthy — a brand-new autopilot isn't a warning.
      healthy: last ? last.status !== "failed" && !isBlockedRun(last) : true,
    });
  }

  return autopilots.sort(
    (a, b) => a.agentName.localeCompare(b.agentName) || a.taskTitle.localeCompare(b.taskTitle),
  );
}
