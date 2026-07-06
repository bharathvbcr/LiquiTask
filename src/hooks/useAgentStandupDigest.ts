import { useEffect, useMemo, useState } from "react";

import agentMcpService from "../services/agents/agentMcpService";
import agentRunService from "../services/agents/agentRunService";
import agentService from "../services/agents/agentService";
import {
  buildAgentStandupDigest,
  formatStandupDigestText,
  type AgentStandupDigest,
} from "../services/agents/agentStandupDigestService";
import notificationService from "../services/notificationService";
import type { Task } from "../../types";

export interface UseAgentStandupOptions {
  /** Show native notification once per app session when digest has activity. */
  notifyOnLoad?: boolean;
  hours?: number;
}

export function useAgentStandupDigest(
  tasks: Task[],
  options: UseAgentStandupOptions = {},
): AgentStandupDigest {
  const [runs, setRuns] = useState(() => agentRunService.getRuns());
  const [permissions, setPermissions] = useState(() =>
    agentMcpService.getPendingPermissions(),
  );

  useEffect(() => agentRunService.subscribe(setRuns), []);
  useEffect(() => agentMcpService.subscribePermissions(setPermissions), []);

  const digest = useMemo(
    () =>
      buildAgentStandupDigest(
        runs,
        tasks,
        agentService.getAgents(),
        permissions,
        { hours: options.hours ?? 12 },
      ),
    [runs, tasks, permissions, options.hours],
  );

  useEffect(() => {
    if (!options.notifyOnLoad) return;
    const key = "liquitask-standup-notified";
    if (sessionStorage.getItem(key)) return;
    const hasActivity =
      digest.completed.length > 0 ||
      digest.failed.length > 0 ||
      digest.blocked.length > 0 ||
      digest.pendingPermissions > 0;
    if (!hasActivity) return;
    sessionStorage.setItem(key, "1");
    void notificationService.requestPermission().then((granted) => {
      if (!granted) return;
      notificationService.show({
        title: "Agent standup",
        body: formatStandupDigestText(digest).split("\n").slice(1, 3).join(" · "),
      });
    });
  }, [digest, options.notifyOnLoad]);

  return digest;
}
