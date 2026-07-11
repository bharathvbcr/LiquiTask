import type { DuplicateGroup, MergeSuggestion, Subtask, Task, TaskCluster } from "../../types";
import { normalizeSubtaskTitles } from "./coerce";

/** Task ids that belong to a duplicate candidate group. */
export function candidateTaskIds(group: DuplicateGroup): Set<string> {
  return new Set(group.tasks.map((t) => t.id));
}

/** Whitelist content fields an AI merge may change — never identity/ownership fields. */
export function sanitizeMergedFields(fields: Partial<Task>): Partial<Task> {
  const out: Partial<Task> = {};
  if (typeof fields.title === "string") out.title = fields.title;
  if (typeof fields.summary === "string") out.summary = fields.summary;
  if (Array.isArray(fields.tags)) {
    out.tags = fields.tags.filter((t): t is string => typeof t === "string");
  }
  if (Array.isArray(fields.subtasks)) out.subtasks = sanitizeMergeSubtasks(fields.subtasks);
  if (typeof fields.timeEstimate === "number" && fields.timeEstimate >= 0) {
    out.timeEstimate = fields.timeEstimate;
  }
  if (typeof fields.timeSpent === "number" && fields.timeSpent >= 0) {
    out.timeSpent = fields.timeSpent;
  }
  return out;
}

/** Shape-validate LLM subtasks into canonical Subtask objects. */
export function sanitizeMergeSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) {
    return normalizeSubtaskTitles(value).map((title, i) => ({
      id: `st-merge-${i}-${Date.now()}`,
      title,
      completed: false,
    }));
  }

  const out: Subtask[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    let title = "";
    let completed = false;
    let id = `st-merge-${i}-${Date.now()}`;

    if (typeof item === "string") {
      title = item.trim();
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (typeof obj.title === "string") title = obj.title.trim();
      if (typeof obj.id === "string" && obj.id.trim()) id = obj.id.trim();
      if (typeof obj.completed === "boolean") completed = obj.completed;
    }

    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, title, completed });
  }

  return out;
}

/**
 * Allowlist keep/archive ids to the duplicate group and sanitize merged fields.
 * Returns null when the model picks ids outside the candidate set.
 */
export function validateMergeSuggestion(
  group: DuplicateGroup,
  raw: MergeSuggestion,
): MergeSuggestion | null {
  const allowed = candidateTaskIds(group);
  if (!allowed.has(raw.keepTaskId)) return null;

  const archiveTaskIds = raw.archiveTaskIds.filter(
    (id) => allowed.has(id) && id !== raw.keepTaskId,
  );
  if (archiveTaskIds.length === 0) return null;

  return {
    keepTaskId: raw.keepTaskId,
    archiveTaskIds,
    mergedFields: sanitizeMergedFields(raw.mergedFields ?? {}),
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "AI merge suggestion",
  };
}

/** Drop LLM task ids that are not in the known task set. */
export function filterClusterToKnownTasks(cluster: TaskCluster, knownIds: Set<string>): TaskCluster {
  return {
    ...cluster,
    taskIds: cluster.taskIds.filter((id) => knownIds.has(id)),
  };
}

export function filterClustersToKnownTasks(
  clusters: TaskCluster[],
  allTasks: Task[],
  minTasks = 1,
): TaskCluster[] {
  const knownIds = new Set(allTasks.map((t) => t.id));
  return clusters
    .map((c) => filterClusterToKnownTasks(c, knownIds))
    .filter((c) => c.taskIds.length >= minTasks);
}

export interface ProjectAssignmentSuggestion {
  taskId: string;
  suggestedProjectId: string;
  confidence: number;
  reasoning: string;
}

/** Keep only assignments whose task and target project exist in the caller's sets. */
export function filterProjectAssignments(
  suggestions: ProjectAssignmentSuggestion[],
  allTasks: Task[],
  projects: { id: string }[],
): ProjectAssignmentSuggestion[] {
  const taskIds = new Set(allTasks.map((t) => t.id));
  const projectIds = new Set(projects.map((p) => p.id));

  return suggestions.filter(
    (s) =>
      typeof s.taskId === "string" &&
      taskIds.has(s.taskId) &&
      typeof s.suggestedProjectId === "string" &&
      projectIds.has(s.suggestedProjectId),
  );
}
