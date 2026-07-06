import { useCallback, useEffect, useState } from "react";

import campaignOrchestratorService from "../services/agents/campaignOrchestratorService";
import type { CampaignResult, CampaignState } from "../services/agents/campaignTypes";
import type { AgentProfile, BoardColumn, Task, ToastType } from "../../types";

interface UseCampaignArgs {
  tasks: Task[];
  columns: BoardColumn[];
  agents: AgentProfile[];
  /** Append materialised subtask board tasks to the board. */
  onCreateTasks?: (tasks: Task[]) => void;
  addToast?: (message: string, type: ToastType) => void;
  /** Optional ntfy topic for phone push notifications. */
  ntfyTopic?: string;
}

/**
 * Wires the campaign orchestrator into the board: launch a campaign from an epic,
 * stream live campaign state, and surface the final verdict as a toast.
 */
export function useCampaign({
  tasks,
  columns,
  agents,
  onCreateTasks,
  addToast,
  ntfyTopic,
}: UseCampaignArgs) {
  const [state, setState] = useState<CampaignState | undefined>(() =>
    campaignOrchestratorService.getState(),
  );
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => campaignOrchestratorService.subscribe(setState), []);

  const startCampaign = useCallback(
    async (epic: Task): Promise<CampaignResult | undefined> => {
      if (campaignOrchestratorService.isRunning()) {
        addToast?.("A campaign is already under way.", "warning");
        return undefined;
      }
      const workers = agents.filter((a) => (a.role ?? "default") !== "planner");
      if (workers.length === 0) {
        addToast?.("No Workers available — add a worker agent first.", "warning");
        return undefined;
      }
      const plannerAgent = agents.find((a) => a.role === "planner") ?? workers[0];

      setIsRunning(true);
      addToast?.(`Commander musters the team for “${epic.title}”…`, "info");
      try {
        const result = await campaignOrchestratorService.startCampaign({
          epic,
          agents,
          columns,
          plannerAgent,
          ntfyTopic,
          onCreateTasks,
        });
        addToast?.(
          `⚔️ Campaign complete — ${result.verified.length} verified, ${result.blocked.length} blocked, ${result.skipped.length} skipped.`,
          result.success ? "success" : "warning",
        );
        return result;
      } catch (err) {
        addToast?.(`Campaign failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        return undefined;
      } finally {
        setIsRunning(false);
      }
    },
    [agents, columns, onCreateTasks, ntfyTopic, addToast],
  );

  const cancelCampaign = useCallback(() => {
    campaignOrchestratorService.cancelCampaign();
    addToast?.("Standing down — in-flight tasks will finish.", "info");
  }, [addToast]);

  // Epics = tasks that already have campaign/epic-linked children, or any task the
  // user selects. We surface all tasks; the panel lets the user choose the epic.
  const epicCandidates = tasks;

  return { state, isRunning, startCampaign, cancelCampaign, epicCandidates };
}

export default useCampaign;
