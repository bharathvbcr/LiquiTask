import type {
  AIContext,
  AutoOrganizeChange,
  AutoOrganizeConfig,
  AutoOrganizeResult,
  HierarchySuggestion,
  PriorityDefinition,
  Project,
  ProjectAssignment,
  TagConsolidationSuggestion,
  Task,
} from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "./aiService";
import storageService from "./storageService";

class AutoOrganizeService {
  private static instance: AutoOrganizeService;

  static getInstance(): AutoOrganizeService {
    if (!AutoOrganizeService.instance) {
      AutoOrganizeService.instance = new AutoOrganizeService();
    }
    return AutoOrganizeService.instance;
  }

  private getContext(): AIContext {
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    return { activeProjectId, projects, priorities };
  }

  private getConfig(): AutoOrganizeConfig {
    return aiService.getAutoOrganizeConfig();
  }

  private filterTasks(allTasks: Task[]): Task[] {
    const config = this.getConfig();
    let filtered = allTasks;
    if (config.excludedProjectIds.length > 0) {
      filtered = filtered.filter((t) => !config.excludedProjectIds.includes(t.projectId));
    }
    if (filtered.length > config.maxTasksPerBatch) {
      filtered = filtered.slice(0, config.maxTasksPerBatch);
    }
    return filtered;
  }

  async runAutoOrganize(
    allTasks: Task[],
    onProgress?: (phase: string, progress: number) => void,
  ): Promise<AutoOrganizeResult> {
    const startTime = Date.now();
    const config = this.getConfig();
    const context = this.getContext();
    const tasks = this.filterTasks(allTasks);
    const changes: AutoOrganizeChange[] = [];

    const phases = [
      { key: "deduplication", run: () => this.runDeduplication(tasks, context, config) },
      { key: "clustering", run: () => this.runClustering(tasks, context, config) },
      { key: "autoTagging", run: () => this.runAutoTagging(tasks, context, config) },
      { key: "hierarchyDetection", run: () => this.runHierarchyDetection(tasks, context, config) },
      { key: "projectAssignment", run: () => this.runProjectAssignment(tasks, context, config) },
      { key: "tagConsolidation", run: () => this.runTagConsolidation(tasks, context, config) },
    ];

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const enabled = config.operations[phase.key as keyof typeof config.operations];
      if (!enabled) continue;

      onProgress?.(phase.key, (i / phases.length) * 100);

      try {
        const phaseChanges = await phase.run();
        changes.push(...phaseChanges);
      } catch (e) {
        console.error(`Auto-organize phase ${phase.key} failed:`, e);
      }
    }

    const autoApplied = changes.filter((c) => c.status === "auto-applied").length;
    const pendingReview = changes.filter((c) => c.status === "pending-review").length;

    const result: AutoOrganizeResult = {
      id: `organize-${Date.now()}`,
      timestamp: new Date(),
      duration: Date.now() - startTime,
      tasksAnalyzed: tasks.length,
      changes,
      autoApplied,
      pendingReview,
    };

    aiService.saveOrganizeHistory(result);
    const updatedConfig = { ...config, lastRunAt: new Date() };
    aiService.saveAutoOrganizeConfig(updatedConfig);

    return result;
  }

  private async runDeduplication(
    tasks: Task[],
    context: AIContext,
    config: AutoOrganizeConfig,
  ): Promise<AutoOrganizeChange[]> {
    const changes: AutoOrganizeChange[] = [];
    if (tasks.length < 2) return changes;

    const taskPairs: Array<{ task1: Task; task2: Task }> = [];
    const titleIndex = new Map<string, string[]>();

    for (const task of tasks) {
      const words = task.title
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      for (const word of words) {
        if (!titleIndex.has(word)) titleIndex.set(word, []);
        titleIndex.get(word)!.push(task.id);
      }
    }

    const pairSet = new Set<string>();
    for (const [, ids] of titleIndex) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = [ids[i], ids[j]].sort().join("-");
          if (!pairSet.has(key)) {
            pairSet.add(key);
            const t1 = tasks.find((t) => t.id === ids[i]);
            const t2 = tasks.find((t) => t.id === ids[j]);
            if (t1 && t2) taskPairs.push({ task1: t1, task2: t2 });
          }
        }
      }
    }

    if (taskPairs.length === 0) return changes;

    const results = await aiService.detectDuplicates(taskPairs, context);

    for (const result of results) {
      if (result.confidence >= config.autoApplyThreshold) {
        const mergedFields = {
          title:
            result.task1.title.length > result.task2.title.length
              ? result.task1.title
              : result.task2.title,
          summary: `${result.task1.summary}\n\n${result.task2.summary}`,
          tags: Array.from(new Set([...result.task1.tags, ...result.task2.tags])),
          subtasks: [...result.task1.subtasks, ...result.task2.subtasks],
        };

        changes.push({
          id: `merge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: "merge",
          taskId: result.task1.id,
          relatedTaskIds: [result.task2.id],
          before: { title: result.task1.title, tags: result.task1.tags },
          after: mergedFields,
          confidence: result.confidence,
          reasoning: result.reasons.join(". "),
          status: "auto-applied",
        });
      } else if (result.confidence >= config.suggestThreshold) {
        changes.push({
          id: `merge-suggest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: "merge",
          taskId: result.task1.id,
          relatedTaskIds: [result.task2.id],
          before: { title: result.task1.title },
          after: { title: result.task2.title },
          confidence: result.confidence,
          reasoning: result.reasons.join(". "),
          status: "pending-review",
        });
      }
    }

    return changes;
  }

  private async runClustering(
    tasks: Task[],
    context: AIContext,
    config: AutoOrganizeConfig,
  ): Promise<AutoOrganizeChange[]> {
    const changes: AutoOrganizeChange[] = [];
    if (tasks.length < 3) return changes;

    const clusters = await aiService.clusterTasks(tasks, context);

    for (const cluster of clusters) {
      if (cluster.confidence >= config.suggestThreshold && cluster.taskIds.length >= 2) {
        for (const taskId of cluster.taskIds) {
          const task = tasks.find((t) => t.id === taskId);
          if (!task) continue;

          const newTags = Array.from(new Set([...task.tags, ...cluster.suggestedTags]));
          const tagsChanged = newTags.length !== task.tags.length;

          if (tagsChanged && cluster.confidence >= config.autoApplyThreshold) {
            changes.push({
              id: `cluster-tag-${Date.now()}-${taskId}`,
              type: "cluster",
              taskId,
              before: { tags: task.tags },
              after: { tags: newTags },
              confidence: cluster.confidence,
              reasoning: `Added cluster tags: ${cluster.suggestedTags.join(", ")} (theme: ${cluster.theme})`,
              status: "auto-applied",
              clusterId: cluster.id,
              clusterTheme: cluster.theme,
            });
          } else if (tagsChanged) {
            changes.push({
              id: `cluster-tag-suggest-${Date.now()}-${taskId}`,
              type: "cluster",
              taskId,
              before: { tags: task.tags },
              after: { tags: newTags },
              confidence: cluster.confidence,
              reasoning: `Suggested cluster tags: ${cluster.suggestedTags.join(", ")} (theme: ${cluster.theme})`,
              status: "pending-review",
              clusterId: cluster.id,
              clusterTheme: cluster.theme,
            });
          }
        }
      }
    }

    return changes;
  }

  private async runAutoTagging(
    tasks: Task[],
    context: AIContext,
    config: AutoOrganizeConfig,
  ): Promise<AutoOrganizeChange[]> {
    const changes: AutoOrganizeChange[] = [];
    if (tasks.length === 0) return changes;

    const suggestions = await aiService.categorizeTasks(tasks, context);

    for (const suggestion of suggestions) {
      if (suggestion.confidence >= config.suggestThreshold && suggestion.suggestedTags.length > 0) {
        const task = tasks.find((t) => t.id === suggestion.taskId);
        if (!task) continue;

        const newTags = Array.from(new Set([...task.tags, ...suggestion.suggestedTags]));
        const tagsChanged = newTags.length !== task.tags.length;

        if (tagsChanged && suggestion.confidence >= config.autoApplyThreshold) {
          changes.push({
            id: `tag-${Date.now()}-${task.id}`,
            type: "tag",
            taskId: task.id,
            before: { tags: task.tags, priority: task.priority },
            after: { tags: newTags, priority: suggestion.suggestedPriority || task.priority },
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            status: "auto-applied",
          });
        } else if (tagsChanged) {
          changes.push({
            id: `tag-suggest-${Date.now()}-${task.id}`,
            type: "tag",
            taskId: task.id,
            before: { tags: task.tags },
            after: { tags: newTags },
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            status: "pending-review",
          });
        }
      }
    }

    return changes;
  }

  private async runHierarchyDetection(
    tasks: Task[],
    context: AIContext,
    _config: AutoOrganizeConfig,
  ): Promise<AutoOrganizeChange[]> {
    const changes: AutoOrganizeChange[] = [];
    if (tasks.length < 3) return changes;

    const taskDetails = tasks
      .map((t) => `ID: ${t.id}\nTitle: "${t.title}"\nSummary: ${t.summary}\nStatus: ${t.status}`)
      .join("\n\n");

    try {
      const result = await aiService.analyzeTasks(
        `Analyze these tasks and identify implicit parent-child relationships, dependency chains, and tasks that should be subtasks of other tasks.\n\nReturn a JSON array where each object has:\n{\n  "type": "parent-child" | "dependency-chain" | "subtask-promotion",\n  "parentTaskId": "the_parent_task_id",\n  "childTaskIds": ["child_1", "child_2"],\n  "confidence": 0.85,\n  "reasoning": "Why these tasks form a hierarchy"\n}\n\nTasks:\n${taskDetails}`,
        tasks,
        context,
      );

      if (Array.isArray(result)) {
        for (const h of result as HierarchySuggestion[]) {
          if (h.confidence >= 0.7) {
            changes.push({
              id: `hierarchy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: "hierarchy",
              taskId: h.parentTaskId,
              relatedTaskIds: h.childTaskIds,
              before: { links: tasks.find((t) => t.id === h.parentTaskId)?.links || [] },
              after: {
                suggestedLinks: h.childTaskIds.map((id) => ({
                  targetTaskId: id,
                  type: "blocks" as const,
                })),
              },
              confidence: h.confidence,
              reasoning: h.reasoning,
              status: "pending-review",
            });
          }
        }
      }
    } catch (e) {
      console.error("Hierarchy detection failed:", e);
    }

    return changes;
  }

  private async runProjectAssignment(
    tasks: Task[],
    context: AIContext,
    config: AutoOrganizeConfig,
  ): Promise<AutoOrganizeChange[]> {
    const changes: AutoOrganizeChange[] = [];
    if (tasks.length < 2 || context.projects.length < 2) return changes;

    const taskDetails = tasks
      .map(
        (t) =>
          `ID: ${t.id}\nTitle: "${t.title}"\nTags: ${t.tags.join(", ")}\nCurrent Project: ${context.projects.find((p) => p.id === t.projectId)?.name || "Unknown"}`,
      )
      .join("\n\n");

    const projectsList = context.projects.map((p) => `ID: ${p.id}, Name: ${p.name}`).join("\n");

    try {
      const result = await aiService.analyzeTasks(
        `Analyze these tasks and suggest which project/workspace each task should belong to based on content, tags, and context.\n\nReturn a JSON array where each object has:\n{\n  "taskId": "task_id",\n  "suggestedProjectId": "project_id",\n  "confidence": 0.85,\n  "reasoning": "Why this project is a better fit"\n}\n\nAvailable Projects:\n${projectsList}\n\nTasks:\n${taskDetails}`,
        tasks,
        context,
      );

      if (Array.isArray(result)) {
        for (const a of result as ProjectAssignment[]) {
          if (a.confidence >= config.suggestThreshold) {
            const task = tasks.find((t) => t.id === a.taskId);
            if (!task || task.projectId === a.suggestedProjectId) continue;

            const currentProject =
              context.projects.find((p) => p.id === task.projectId)?.name || "Unknown";
            const suggestedProject =
              context.projects.find((p) => p.id === a.suggestedProjectId)?.name || "Unknown";

            changes.push({
              id: `project-move-${Date.now()}-${task.id}`,
              type: "project-move",
              taskId: task.id,
              before: { projectId: task.projectId, project: currentProject },
              after: { projectId: a.suggestedProjectId, project: suggestedProject },
              confidence: a.confidence,
              reasoning: a.reasoning,
              status: a.confidence >= config.autoApplyThreshold ? "auto-applied" : "pending-review",
            });
          }
        }
      }
    } catch (e) {
      console.error("Project assignment failed:", e);
    }

    return changes;
  }

  private async runTagConsolidation(
    tasks: Task[],
    context: AIContext,
    config: AutoOrganizeConfig,
  ): Promise<AutoOrganizeChange[]> {
    const changes: AutoOrganizeChange[] = [];

    const allTags = new Set<string>();
    for (const task of tasks) {
      for (const tag of task.tags) {
        allTags.add(tag);
      }
    }

    if (allTags.size < 4) return changes;

    const taskDetails = tasks
      .map((t) => `ID: ${t.id}\nTitle: "${t.title}"\nTags: ${t.tags.join(", ")}`)
      .join("\n\n");

    try {
      const result = await aiService.analyzeTasks(
        `Analyze all tags used across these tasks and identify tags that should be consolidated (merged) because they represent the same concept.\n\nReturn a JSON array where each object has:\n{\n  "tags": ["tag1", "tag2"],\n  "suggestedTag": "canonical_tag",\n  "affectedTaskIds": ["task_id_1", "task_id_2"],\n  "confidence": 0.85,\n  "reasoning": "Why these tags should be merged"\n}\n\nAll unique tags: ${Array.from(allTags).join(", ")}\n\nTasks:\n${taskDetails}`,
        tasks,
        context,
      );

      if (Array.isArray(result)) {
        for (const c of result as TagConsolidationSuggestion[]) {
          if (c.confidence >= config.suggestThreshold && c.affectedTaskIds.length > 0) {
            changes.push({
              id: `tag-consolidate-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: "tag-consolidate",
              taskId: c.affectedTaskIds[0],
              relatedTaskIds: c.affectedTaskIds.slice(1),
              before: { tags: c.tags },
              after: { tags: [c.suggestedTag] },
              confidence: c.confidence,
              reasoning: c.reasoning,
              status: c.confidence >= config.autoApplyThreshold ? "auto-applied" : "pending-review",
            });
          }
        }
      }
    } catch (e) {
      console.error("Tag consolidation failed:", e);
    }

    return changes;
  }

  async applyChanges(
    changes: AutoOrganizeChange[],
    callbacks: {
      onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
      onArchiveTask: (taskId: string) => void;
      onMoveTask: (taskId: string, newProjectId: string) => void;
    },
  ): Promise<{ applied: number; rejected: number }> {
    let applied = 0;
    let rejected = 0;

    for (const change of changes) {
      if (change.status === "rejected") {
        rejected++;
        continue;
      }

      try {
        switch (change.type) {
          case "tag":
          case "cluster":
            callbacks.onUpdateTask(change.taskId, { tags: change.after.tags as string[] });
            if (change.after.priority) {
              callbacks.onUpdateTask(change.taskId, { priority: change.after.priority as string });
            }
            applied++;
            break;

          case "merge":
            if (change.relatedTaskIds) {
              for (const archiveId of change.relatedTaskIds) {
                callbacks.onArchiveTask(archiveId);
              }
            }
            callbacks.onUpdateTask(change.taskId, change.after as Partial<Task>);
            applied++;
            break;

          case "project-move":
            callbacks.onMoveTask(change.taskId, change.after.projectId as string);
            applied++;
            break;

          case "tag-consolidate":
            if (change.relatedTaskIds) {
              for (const taskId of [change.taskId, ...change.relatedTaskIds]) {
                const task = this.getTaskById(taskId);
                if (task) {
                  const newTags = task.tags.map((t) =>
                    (change.before.tags as string[]).includes(t)
                      ? (change.after.tags as string[])[0]
                      : t,
                  );
                  callbacks.onUpdateTask(taskId, { tags: Array.from(new Set(newTags)) });
                }
              }
            }
            applied++;
            break;

          case "hierarchy":
            if (change.relatedTaskIds) {
              const task = this.getTaskById(change.taskId);
              if (task) {
                const newLinks = [
                  ...(task.links || []),
                  ...change.relatedTaskIds.map((id) => ({
                    targetTaskId: id,
                    type: "relates-to" as const,
                  })),
                ];
                callbacks.onUpdateTask(change.taskId, { links: newLinks });
              }
            }
            applied++;
            break;
        }
      } catch (e) {
        console.error(`Failed to apply change ${change.id}:`, e);
        rejected++;
      }
    }

    return { applied, rejected };
  }

  private getTaskById(taskId: string): Task | undefined {
    const tasks = storageService.get<Task[]>(STORAGE_KEYS.TASKS, []);
    return tasks.find((t) => t.id === taskId);
  }

  getHistory(): AutoOrganizeResult[] {
    return aiService.getOrganizeHistory();
  }

  clearHistory(): void {
    storageService.remove(STORAGE_KEYS.AUTO_ORGANIZE_HISTORY);
  }
}

export const autoOrganizeService = AutoOrganizeService.getInstance();
export default autoOrganizeService;
