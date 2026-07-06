import type { AgentProfile, AgentRun, Task } from "../../../types";

/** Default Claude model ids used when `modelRouting === 'auto'`. */
export const DEFAULT_HAIKU_MODEL = "claude-haiku-4-5";
export const DEFAULT_SONNET_MODEL = "claude-sonnet-4-5";
export const DEFAULT_OPUS_MODEL = "claude-opus-4-5";

export const ESTIMATE_HAIKU_MAX_MIN = 30;
export const ESTIMATE_SONNET_MAX_MIN = 120;

type ModelTier = "haiku" | "sonnet" | "opus";

const TIER_ORDER: Record<ModelTier, number> = {
  haiku: 0,
  sonnet: 1,
  opus: 2,
};

const TIER_MODEL: Record<ModelTier, string> = {
  haiku: DEFAULT_HAIKU_MODEL,
  sonnet: DEFAULT_SONNET_MODEL,
  opus: DEFAULT_OPUS_MODEL,
};

function priorityTier(priority: string | undefined): ModelTier {
  switch ((priority ?? "medium").trim().toLowerCase()) {
    case "low":
      return "haiku";
    case "high":
      return "opus";
    default:
      return "sonnet";
  }
}

function estimateTier(minutes: number): ModelTier {
  if (minutes <= ESTIMATE_HAIKU_MAX_MIN) return "haiku";
  if (minutes <= ESTIMATE_SONNET_MAX_MIN) return "sonnet";
  return "opus";
}

function maxTier(a: ModelTier, b: ModelTier): ModelTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

/** Local midnight for the given instant. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Runs started today (local calendar day) for one agent. */
export function getAgentDailyStats(
  agentId: string,
  runs: AgentRun[],
): { runCount: number; spendUsd: number } {
  const todayStart = startOfLocalDay(new Date());
  const todayRuns = runs.filter(
    (r) => r.agentId === agentId && r.startedAt && r.startedAt >= todayStart,
  );
  return {
    runCount: todayRuns.length,
    spendUsd: todayRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  };
}

/** Returns an error message when a budget guard would block a new run. */
export function checkAgentBudget(
  agent: AgentProfile,
  stats: { runCount: number; spendUsd: number },
): string | null {
  const costCap = agent.dailyCostCapUsd;
  if (costCap != null && costCap > 0 && stats.spendUsd >= costCap) {
    return `Daily cost cap $${costCap.toFixed(2)} exceeded ($${stats.spendUsd.toFixed(2)} spent today)`;
  }
  const maxRuns = agent.maxRunsPerDay;
  if (maxRuns != null && maxRuns > 0 && stats.runCount >= maxRuns) {
    return `Max runs per day (${maxRuns}) reached (${stats.runCount} started today)`;
  }
  return null;
}

/** Resolve the model string for a new agent run. */
export function resolveAgentModel(agent: AgentProfile, task: Task): string | undefined {
  const routing = agent.modelRouting ?? "fixed";
  if (routing !== "auto") {
    return agent.model?.trim() || undefined;
  }

  const tier = maxTier(priorityTier(task.priority), estimateTier(task.timeEstimate ?? 0));
  return TIER_MODEL[tier];
}
