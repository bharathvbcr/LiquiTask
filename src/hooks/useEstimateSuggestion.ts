import { useEffect, useMemo, useState } from "react";

import agentRunService from "../services/agents/agentRunService";
import {
  formatEstimateHint,
  suggestCalibratedEstimate,
  type EstimateSuggestion,
} from "../services/agents/agentEstimateLearningService";
import type { Task } from "../../types";

export function useEstimateSuggestion(
  task: Pick<Task, "title" | "priority" | "tags" | "assignee" | "timeEstimate">,
  allTasks: Task[],
): {
  suggestion: EstimateSuggestion | null;
  hint: string | null;
} {
  const [runs, setRuns] = useState(() => agentRunService.getRuns());

  useEffect(() => agentRunService.subscribe(setRuns), []);

  const suggestion = useMemo(
    () => suggestCalibratedEstimate(task, allTasks, runs),
    [task.title, task.priority, task.assignee, task.timeEstimate, task.tags, allTasks, runs, task],
  );

  const hint = useMemo(() => {
    if (!suggestion) return null;
    return formatEstimateHint(suggestion, task.timeEstimate ?? 0);
  }, [suggestion, task.timeEstimate]);

  return { suggestion, hint };
}
