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
import { STORAGE_KEYS, LINK_TYPES } from "../constants";
import { toCoreTask } from "../runtime/coreDto";
import { callNative } from "../runtime/runtimeEnvironment";
import { aiService } from "./aiService";
import {
  CONSOLIDATE_TAGS_PROMPT,
  DETECT_HIERARCHY_PROMPT,
  SUGGEST_PROJECT_ASSIGNMENT_PROMPT,
  fillOrganizePrompt,
} from "./prompts/organize-prompts";
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

  /**
   * Pure pre-filter: exclude configured project ids, then cap to the batch size.
   *
   * The kept-id computation is delegated to the `liquitask-core` Rust crate via
   * `autoorg_filter_task_ids` (desktop) and falls back to the identical JS on
   * the web/PWA build. Rust returns only the ids; we re-hydrate them back into
   * `Task[]` here so the public shape is unchanged.
   */
  private async filterTasks(allTasks: Task[]): Promise<Task[]> {
    const config = this.getConfig();

    const jsFilterIds = (): string[] => {
      let filtered = allTasks;
      if (config.excludedProjectIds.length > 0) {
        filtered = filtered.filter((t) => !config.excludedProjectIds.includes(t.projectId));
      }
      if (filtered.length > config.maxTasksPerBatch) {
        filtered = filtered.slice(0, config.maxTasksPerBatch);
      }
      return filtered.map((t) => t.id);
    };

    const keptIds = await callNative<string[]>(
      "autoorg_filter_task_ids",
      {
        tasks: allTasks.map(toCoreTask),
        excludedProjectIds: config.excludedProjectIds,
        maxTasksPerBatch: config.maxTasksPerBatch,
      },
      jsFilterIds,
    );

    // Re-hydrate ids -> Task[] preserving the returned order.
    const byId = new Map(allTasks.map((t) => [t.id, t]));
    return keptIds.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined);
  }

  async runAutoOrganize(
    allTasks: Task[],
    onProgress?: (phase: string, progress: number) => void,
  ): Promise<AutoOrganizeResult> {
    const startTime = Date.now();
    const config = this.getConfig();
    const context = this.getContext();
    const tasks = await this.filterTasks(allTasks);
    const changes: AutoOrganizeChange[] = [];

    // Define phases grouped by independence
    // Group 1: Structural changes (Deduplication, Clustering, Hierarchy)
    // Group 2: Metadata changes (Tagging, Project Assignment, Tag Consolidation)
    const phaseGroups = [
      [
        { key: "deduplication", run: () => this.runDeduplication(tasks, context, config) },
        { key: "clustering", run: () => this.runClustering(tasks, context, config) },
        {
          key: "hierarchyDetection",
          run: () => this.runHierarchyDetection(tasks, context, config),
        },
      ],
      [
        { key: "autoTagging", run: () => this.runAutoTagging(tasks, context, config) },
        { key: "projectAssignment", run: () => this.runProjectAssignment(tasks, context, config) },
        { key: "tagConsolidation", run: () => this.runTagConsolidation(tasks, context, config) },
      ],
    ];

    const totalPhases = phaseGroups.flat().length;

    for (let groupIndex = 0; groupIndex < phaseGroups.length; groupIndex++) {
      const group = phaseGroups[groupIndex];
      const groupPromises = group.map(async (phase, phaseIndex) => {
        const enabled = config.operations[phase.key as keyof typeof config.operations];
        if (!enabled) {
          // Compute progress based on deterministic index so concurrent phases don't share stale state
          const completedSoFar = groupIndex * group.length + phaseIndex + 1;
          onProgress?.(phase.key, (completedSoFar / totalPhases) * 100);
          return [];
        }

        try {
          const phaseChanges = await phase.run();
          // Increment and report progress only after the phase finishes so the value is accurate
          const completedSoFar = groupIndex * group.length + phaseIndex + 1;
          onProgress?.(phase.key, (completedSoFar / totalPhases) * 100);
          return phaseChanges;
        } catch (e) {
          console.error(`Auto-organize phase ${phase.key} failed:`, e);
          const completedSoFar = groupIndex * group.length + phaseIndex + 1;
          onProgress?.(phase.key, (completedSoFar / totalPhases) * 100);
          return [];
        }
      });

      const groupResults = await Promise.all(groupPromises);
      groupResults.forEach((res) => {
        changes.push(...res);
      });
    }

    onProgress?.("complete", 100);

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

    // Candidate-pair generation (the deterministic step BEFORE aiService) is
    // delegated to the `liquitask-core` Rust crate via
    // `autoorg_dedup_candidate_pairs`, with the identical JS as web fallback.
    // Rust returns unique unordered id-pairs; we map them back to task refs.
    const jsCandidatePairs = (): Array<[string, string]> => {
      const titleIndex = new Map<string, string[]>();
      for (const task of tasks) {
        const words = task.title
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        for (const word of words) {
          if (!titleIndex.has(word)) titleIndex.set(word, []);
          titleIndex.get(word)?.push(task.id);
        }
      }

      const pairSet = new Set<string>();
      const out: Array<[string, string]> = [];
      for (const [, ids] of titleIndex) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const sorted = [ids[i], ids[j]].sort();
            const key = sorted.join("-");
            if (!pairSet.has(key)) {
              pairSet.add(key);
              out.push([sorted[0], sorted[1]]);
            }
          }
        }
      }
      return out;
    };

    const candidateIdPairs = await callNative<Array<[string, string]>>(
      "autoorg_dedup_candidate_pairs",
      { tasks: tasks.map(toCoreTask) },
      jsCandidatePairs,
    );

    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const taskPairs: Array<{ task1: Task; task2: Task }> = [];
    for (const [id1, id2] of candidateIdPairs) {
      const t1 = taskById.get(id1);
      const t2 = taskById.get(id2);
      if (t1 && t2) taskPairs.push({ task1: t1, task2: t2 });
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
          id: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
          id: `merge-suggest-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
          const originalTagSet = new Set(task.tags);
          const tagsChanged = newTags.some(t => !originalTagSet.has(t));

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
        const originalTagSet = new Set(task.tags);
        const tagsChanged = newTags.some(t => !originalTagSet.has(t));

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
        fillOrganizePrompt(DETECT_HIERARCHY_PROMPT, {
          workspace: context.activeProjectId || "default",
          date: new Date().toISOString().slice(0, 10),
          tasks: taskDetails,
        }),
        tasks,
        context,
      );

      if (Array.isArray(result)) {
        for (const h of result as HierarchySuggestion[]) {
          if (h.confidence >= 0.7) {
            changes.push({
              id: `hierarchy-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              type: "hierarchy",
              taskId: h.parentTaskId,
              relatedTaskIds: h.childTaskIds,
              before: { links: tasks.find((t) => t.id === h.parentTaskId)?.links || [] },
              after: {
                suggestedLinks: h.childTaskIds.map((id) => ({
                  targetTaskId: id,
                  type: LINK_TYPES.BLOCKS,
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
        fillOrganizePrompt(SUGGEST_PROJECT_ASSIGNMENT_PROMPT, {
          workspace: context.activeProjectId || "default",
          projects: projectsList,
          date: new Date().toISOString().slice(0, 10),
          tasks: taskDetails,
        }),
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
        fillOrganizePrompt(CONSOLIDATE_TAGS_PROMPT, {
          allTags: Array.from(allTags).join(", "),
          tasks: taskDetails,
        }),
        tasks,
        context,
      );

      if (Array.isArray(result)) {
        for (const c of result as TagConsolidationSuggestion[]) {
          if (c.confidence >= config.suggestThreshold && c.affectedTaskIds.length > 0) {
            changes.push({
              id: `tag-consolidate-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
    allTasks: Task[],
    callbacks: {
      onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
      onArchiveTask: (taskId: string) => void;
      onMoveTask: (taskId: string, newProjectId: string) => void;
    },
  ): Promise<{ applied: number; rejected: number }> {
    let applied = 0;
    let rejected = 0;

    // Build an in-memory task map from the live React task list so changes are
    // applied against current state, not a debounce-lagged storage snapshot.
    const taskMap = new Map<string, Task>(allTasks.map((t) => [t.id, t]));

    for (const change of changes) {
      if (change.status === "rejected") {
        rejected++;
        continue;
      }

      try {
        switch (change.type) {
          case "tag":
          case "cluster": {
            const newTags = change.after.tags as string[];
            callbacks.onUpdateTask(change.taskId, { tags: newTags });
            // Keep the map in sync so subsequent changes see this update
            const tagTask = taskMap.get(change.taskId);
            if (tagTask) taskMap.set(change.taskId, { ...tagTask, tags: newTags });
            if (change.after.priority) {
              const newPriority = change.after.priority as string;
              callbacks.onUpdateTask(change.taskId, { priority: newPriority });
              const priorityTask = taskMap.get(change.taskId);
              if (priorityTask) taskMap.set(change.taskId, { ...priorityTask, priority: newPriority });
            }
            applied++;
            break;
          }

          case "merge":
            if (change.relatedTaskIds) {
              for (const archiveId of change.relatedTaskIds) {
                callbacks.onArchiveTask(archiveId);
                taskMap.delete(archiveId);
              }
            }
            callbacks.onUpdateTask(change.taskId, change.after as Partial<Task>);
            {
              const mergeTask = taskMap.get(change.taskId);
              if (mergeTask) taskMap.set(change.taskId, { ...mergeTask, ...(change.after as Partial<Task>) });
            }
            applied++;
            break;

          case "project-move":
            callbacks.onMoveTask(change.taskId, change.after.projectId as string);
            {
              const moveTask = taskMap.get(change.taskId);
              if (moveTask) taskMap.set(change.taskId, { ...moveTask, projectId: change.after.projectId as string });
            }
            applied++;
            break;

          case "tag-consolidate":
            if (change.relatedTaskIds) {
              const before = change.before.tags as string[];
              const suggested = (change.after.tags as string[])[0];
              for (const taskId of [change.taskId, ...change.relatedTaskIds]) {
                // Use the in-memory map instead of re-reading from storage (fixes issues #2 and #3)
                const task = taskMap.get(taskId);
                if (task) {
                  // Tag remap + dedupe delegated to the `liquitask-core` Rust
                  // crate via `autoorg_consolidate_tags`, JS fallback for web.
                  const jsConsolidate = (): string[] => {
                    const newTags = task.tags.map((t) =>
                      before.includes(t) ? suggested : t,
                    );
                    return Array.from(new Set(newTags));
                  };
                  const dedupedTags = await callNative<string[]>(
                    "autoorg_consolidate_tags",
                    { tags: task.tags, before, suggested },
                    jsConsolidate,
                  );
                  callbacks.onUpdateTask(taskId, { tags: dedupedTags });
                  // Keep the map in sync so subsequent consolidations see the updated tags
                  taskMap.set(taskId, { ...task, tags: dedupedTags });
                }
              }
            }
            applied++;
            break;

          case "hierarchy":
            if (change.relatedTaskIds) {
              // Use the in-memory map to avoid re-reading from storage
              const task = taskMap.get(change.taskId);
              if (task) {
                const newLinks = [
                  ...(task.links || []),
                  ...change.relatedTaskIds.map((id) => ({
                    targetTaskId: id,
                    type: LINK_TYPES.RELATES_TO,
                  })),
                ];
                callbacks.onUpdateTask(change.taskId, { links: newLinks });
                taskMap.set(change.taskId, { ...task, links: newLinks });
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

  getHistory(): AutoOrganizeResult[] {
    return aiService.getOrganizeHistory();
  }

  clearHistory(): void {
    storageService.remove(STORAGE_KEYS.AUTO_ORGANIZE_HISTORY);
  }
}

export const autoOrganizeService = AutoOrganizeService.getInstance();
export default autoOrganizeService;
