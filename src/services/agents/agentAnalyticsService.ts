import type { AgentProfile, AgentRun } from "../../../types";

export interface AgentAnalytics {
  agentId: string;
  agentName: string;
  totalRuns: number;
  completed: number;
  failed: number;
  successRate: number;
  avgCostUsd: number;
  avgTurns: number;
  avgDurationMs: number;
  gatePassRate: number;
}

/** Sync API used by UI (`useMemo`). Desktop async path lives in `nativeBridge.nativeComputeAgentAnalytics`. */
export function computeAgentAnalytics(
  agents: AgentProfile[],
  runs: AgentRun[],
): AgentAnalytics[] {
  return agents.map((agent) => {
    const agentRuns = runs.filter((r) => r.agentId === agent.id);
    const finished = agentRuns.filter((r) => r.status === "completed" || r.status === "failed");
    const completed = finished.filter((r) => r.status === "completed");
    const withGate = finished.filter((r) => r.verification !== undefined);
    const gatePassed = withGate.filter((r) => r.verification?.passed);

    const durations = finished
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
    const costs = finished.filter((r) => typeof r.costUsd === "number").map((r) => r.costUsd!);
    const turns = finished.filter((r) => typeof r.numTurns === "number").map((r) => r.numTurns!);

    const avg = (nums: number[]) =>
      nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

    return {
      agentId: agent.id,
      agentName: agent.name,
      totalRuns: agentRuns.length,
      completed: completed.length,
      failed: finished.length - completed.length,
      successRate: finished.length ? completed.length / finished.length : 0,
      avgCostUsd: avg(costs),
      avgTurns: avg(turns),
      avgDurationMs: avg(durations),
      gatePassRate: withGate.length ? gatePassed.length / withGate.length : 0,
    };
  });
}
