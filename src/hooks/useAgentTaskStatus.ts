import { useEffect, useMemo, useState } from "react";

import agentRunService from "../services/agents/agentRunService";
import agentService from "../services/agents/agentService";
import type { AgentRun, AgentRunStatus } from "../../types";

export interface AgentTaskStatus {
  /** The task's assignee is an agent profile. */
  isAgentTask: boolean;
  /** Status of the task's active run, if any. */
  runStatus: AgentRunStatus | null;
  /** Most recent completed run for this task (for review actions). */
  completedRun: AgentRun | null;
}

/**
 * Lightweight per-card status: whether the assignee is an agent and whether
 * that agent is currently working the task. Subscribes to the run service so
 * cards update live without prop-drilling through the board tree.
 */
export const useAgentTaskStatus = (
  taskId: string,
  assignee: string | undefined,
): AgentTaskStatus => {
  const [runStatus, setRunStatus] = useState<AgentRunStatus | null>(null);
  const [completedRun, setCompletedRun] = useState<AgentRun | null>(null);

  const isAgentTask = useMemo(() => agentService.isAgentAssignee(assignee), [assignee]);

  useEffect(() => {
    if (!isAgentTask) {
      setRunStatus(null);
      setCompletedRun(null);
      return;
    }
    const update = () => {
      setRunStatus(agentRunService.getActiveRunForTask(taskId)?.status ?? null);
      setCompletedRun(
        agentRunService.getRunsForTask(taskId).find((r) => r.status === "completed") ?? null,
      );
    };
    update();
    return agentRunService.subscribe(update);
  }, [taskId, isAgentTask]);

  return { isAgentTask, runStatus, completedRun };
};

export default useAgentTaskStatus;
