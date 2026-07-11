import type { AgentRun } from "../../types";
import {
  estimateCostUsdFromUsage,
  type AgentdTokenUsage,
} from "../services/agents/agentdCost";

export interface RunCostDisplay {
  costUsd: number;
  totalTokens: number;
  /** True when cost was derived from token rates, not a provider-reported total. */
  estimated: boolean;
}

/** Sum all token fields across every model bucket in a usage map. */
export function sumTokenUsage(usage?: Record<string, AgentdTokenUsage>): number {
  if (!usage) return 0;
  let total = 0;
  for (const entry of Object.values(usage)) {
    total +=
      (entry.inputTokens ?? 0) +
      (entry.outputTokens ?? 0) +
      (entry.cacheReadTokens ?? 0) +
      (entry.cacheWriteTokens ?? 0);
  }
  return total;
}

/**
 * Best-effort cost + token summary for a run. Prefers an explicit `costUsd`
 * from the provider; falls back to usage-based estimation (marked estimated).
 */
export function deriveRunCostDisplay(run: AgentRun): RunCostDisplay | null {
  const usageEstimate = estimateCostUsdFromUsage(run.usage);
  const totalTokens = sumTokenUsage(run.usage);

  if (typeof run.costUsd === "number") {
    return {
      costUsd: run.costUsd,
      totalTokens,
      // Partial usage during an active run still means the dollar total is inferred.
      estimated: usageEstimate !== undefined && run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled",
    };
  }

  if (usageEstimate !== undefined) {
    return { costUsd: usageEstimate, totalTokens, estimated: true };
  }

  return null;
}

/** Format a USD amount, prefixing with ~ when the value is estimated. */
export function formatCostUsd(amount: number, estimated: boolean): string {
  const value = `$${amount.toFixed(2)}`;
  return estimated ? `~${value}` : value;
}

/** Compact token count for inline UI (e.g. 12.4k, 1.2M). */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/**
 * Per-agent session spend: sum every run for the agent that has a known cost.
 * Active runs contribute live usage-derived estimates.
 */
export function deriveAgentSessionCost(
  agentId: string,
  runs: AgentRun[],
): RunCostDisplay | null {
  let costUsd = 0;
  let totalTokens = 0;
  let hasCost = false;
  let estimated = false;

  for (const run of runs) {
    if (run.agentId !== agentId) continue;
    const display = deriveRunCostDisplay(run);
    if (!display) continue;
    hasCost = true;
    costUsd += display.costUsd;
    totalTokens += display.totalTokens;
    if (display.estimated) estimated = true;
  }

  return hasCost ? { costUsd, totalTokens, estimated } : null;
}
