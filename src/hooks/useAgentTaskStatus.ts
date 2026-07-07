import { useEffect, useMemo, useState } from "react";

import agentDispatchService from "../services/agents/agentDispatchService";
import agentMcpService, {
  type AgentPermissionRequest,
} from "../services/agents/agentMcpService";
import agentRunService from "../services/agents/agentRunService";
import agentService from "../services/agents/agentService";
import type { AgentRun, AgentRunStatus } from "../../types";

export interface AgentTaskStatus {
  /** The task's assignee is an agent profile. */
  isAgentTask: boolean;
  /** A dispatch is in flight — instant acknowledgment before the run exists. */
  sending: boolean;
  /** Status of the task's active run, if any. */
  runStatus: AgentRunStatus | null;
  /** 1-based position in the agent's wait line while the run is queued. */
  queuePosition: number | null;
  /** The run is stalled on a permission prompt awaiting the user. */
  pendingPermission: boolean;
  /** Oldest pending permission request, for inline approve/deny on the card. */
  permissionRequest: AgentPermissionRequest | null;
  /** Id of the active (queued/running/verifying) run, for card-level cancel. */
  activeRunId: string | null;
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
  const [sending, setSending] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<AgentPermissionRequest | null>(
    null,
  );
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [completedRun, setCompletedRun] = useState<AgentRun | null>(null);

  const isAgentTask = useMemo(() => agentService.isAgentAssignee(assignee), [assignee]);

  // Track "sending" regardless of assignee — dispatch may not have written the
  // agent onto the task yet when the acknowledgment needs to appear.
  useEffect(
    () =>
      agentDispatchService.subscribeInFlight((ids) => {
        setSending(ids.has(taskId));
      }),
    [taskId],
  );

  useEffect(() => {
    if (!isAgentTask) {
      setRunStatus(null);
      setQueuePosition(null);
      setPermissionRequest(null);
      setActiveRunId(null);
      setCompletedRun(null);
      return;
    }
    const update = () => {
      const active = agentRunService.getActiveRunForTask(taskId);
      setRunStatus(active?.status ?? null);
      setActiveRunId(active?.id ?? null);
      setQueuePosition(
        active?.status === "queued" ? agentRunService.getQueuePosition(taskId) : null,
      );
      setCompletedRun(
        agentRunService.getRunsForTask(taskId).find((r) => r.status === "completed") ?? null,
      );
    };
    update();
    const unsubscribeRuns = agentRunService.subscribe(update);
    // Surface silent permission stalls on the card itself, not just via toast.
    const unsubscribePerms = agentMcpService.subscribePermissions((requests) => {
      setPermissionRequest(requests.find((r) => r.taskId === taskId) ?? null);
    });
    return () => {
      unsubscribeRuns();
      unsubscribePerms();
    };
  }, [taskId, isAgentTask]);

  return {
    isAgentTask,
    sending,
    runStatus,
    queuePosition,
    pendingPermission: permissionRequest !== null,
    permissionRequest,
    activeRunId,
    completedRun,
  };
};

export default useAgentTaskStatus;
