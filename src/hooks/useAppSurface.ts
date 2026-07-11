import { useMemo, useState } from "react";

import type { AgentProfile, AgentRun, Task } from "../../types";

/** v3 shell surfaces (FEATURE_FLAGS.V3_SHELL_ENABLED). Run is an overlay, not a tab. */
export type AppSurface = "inbox" | "board" | "agents";

export function useAppSurface(initialSurface: AppSurface | (() => AppSurface) = "board") {
  const [activeSurface, setActiveSurface] = useState<AppSurface>(initialSurface);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return {
    activeSurface,
    setActiveSurface,
    selectedRunId,
    setSelectedRunId,
  };
}

export function useSelectedRunContext(
  selectedRunId: string | null,
  agentRuns: AgentRun[],
  agents: AgentProfile[],
  tasks: Task[],
) {
  return useMemo(() => {
    const selectedRun = selectedRunId
      ? (agentRuns.find((r) => r.id === selectedRunId) ?? null)
      : null;
    const selectedRunAgent = selectedRun
      ? agents.find((a) => a.id === selectedRun.agentId)
      : undefined;
    const selectedRunTask = selectedRun
      ? tasks.find((t) => t.id === selectedRun.taskId)
      : undefined;
    return { selectedRun, selectedRunAgent, selectedRunTask };
  }, [selectedRunId, agentRuns, agents, tasks]);
}
