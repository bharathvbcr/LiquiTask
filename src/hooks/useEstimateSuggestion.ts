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
    [task.title, task.priority, task.assignee, task.timeEstimate, task.tags, allTasks, runs],
  );

  const hint = useMemo(() => {
    if (!suggestion) return null;
    return formatEstimateHint(suggestion, task.timeEstimate ?? 0);
  }, [suggestion, task.timeEstimate]);

  return { suggestion, hint };
}

/** Convenience hook for cards — only shows hint when estimate is missing or far off. */
export function useTaskEstimateHint(task: Task, allTasks: Task[]): string | null {
  const { suggestion, hint } = useEstimateSuggestion(task, allTasks);
  if (!suggestion || !hint) return null;
  if (task.timeEstimate <= 0) return hint;
  const delta = Math.abs(task.timeEstimate - suggestion.minutes);
  if (delta >= 15) return hint;
  return null;
}
