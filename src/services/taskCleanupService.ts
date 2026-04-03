import type {
  AICategorySuggestion,
  AIContext,
  DuplicateGroup,
  MergeSuggestion,
  PriorityDefinition,
  Project,
  RedundancyAnalysis,
  Task,
  TaskCluster,
} from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "./aiService";
import storageService from "./storageService";

class TaskCleanupService {
  private static instance: TaskCleanupService;

  static getInstance(): TaskCleanupService {
    if (!TaskCleanupService.instance) {
      TaskCleanupService.instance = new TaskCleanupService();
    }
    return TaskCleanupService.instance;
  }

  async detectDuplicates(allTasks: Task[], threshold: number = 0.75): Promise<DuplicateGroup[]> {
    if (allTasks.length < 2) return [];

    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

    const context: AIContext = {
      activeProjectId,
      projects,
      priorities,
    };

    const taskPairs: Array<{ task1: Task; task2: Task }> = [];
    for (let i = 0; i < allTasks.length; i++) {
      for (let j = i + 1; j < allTasks.length; j++) {
        const t1 = allTasks[i];
        const t2 = allTasks[j];
        if (t1.projectId === t2.projectId || t1.title.toLowerCase() === t2.title.toLowerCase()) {
          taskPairs.push({ task1: t1, task2: t2 });
        }
      }
    }

    if (taskPairs.length === 0) return [];

    const duplicateGroups: DuplicateGroup[] = [];
    const processedTaskIds = new Set<string>();

    try {
      const results = await aiService.detectDuplicates(taskPairs, context);

      for (const result of results) {
        if (result.confidence >= threshold) {
          const tasksInGroup = [result.task1, result.task2].filter(
            (t) => !processedTaskIds.has(t.id),
          );

          if (tasksInGroup.length > 1) {
            duplicateGroups.push({
              id: `dup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              tasks: tasksInGroup,
              confidence: result.confidence,
              reasons: result.reasons,
            });

            tasksInGroup.forEach((t) => {
              processedTaskIds.add(t.id);
            });
          }
        }
      }
    } catch (error) {
      console.error("AI duplicate detection failed, falling back to heuristic:", error);
      return this.heuristicDuplicateDetection(allTasks, threshold);
    }

    return duplicateGroups;
  }

  private heuristicDuplicateDetection(allTasks: Task[], threshold: number): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < allTasks.length; i++) {
      if (processed.has(allTasks[i].id)) continue;

      const group: Task[] = [allTasks[i]];

      for (let j = i + 1; j < allTasks.length; j++) {
        if (processed.has(allTasks[j].id)) continue;

        const similarity = this.calculateTitleSimilarity(allTasks[i].title, allTasks[j].title);
        const tagOverlap = this.calculateTagOverlap(allTasks[i].tags, allTasks[j].tags);
        const combinedScore = similarity * 0.7 + tagOverlap * 0.3;

        if (combinedScore >= threshold) {
          group.push(allTasks[j]);
          processed.add(allTasks[j].id);
        }
      }

      if (group.length > 1) {
        groups.push({
          id: `dup-heuristic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tasks: group,
          confidence: this.calculateGroupConfidence(group),
          reasons: ["Heuristic match: similar titles and/or tags"],
        });
        processed.add(group[0].id);
      }
    }

    return groups;
  }

  private calculateTitleSimilarity(title1: string, title2: string): number {
    const normalize = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .trim();

    const n1 = normalize(title1);
    const n2 = normalize(title2);

    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.85;

    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  private calculateTagOverlap(tags1: string[], tags2: string[]): number {
    if (tags1.length === 0 && tags2.length === 0) return 0;

    const set1 = new Set(tags1);
    const set2 = new Set(tags2);
    const intersection = new Set([...set1].filter((t) => set2.has(t)));

    return intersection.size / Math.max(set1.size, set2.size);
  }

  private calculateGroupConfidence(tasks: Task[]): number {
    if (tasks.length < 2) return 0;

    let totalSimilarity = 0;
    let pairs = 0;

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        totalSimilarity += this.calculateTitleSimilarity(tasks[i].title, tasks[j].title);
        pairs++;
      }
    }

    return pairs > 0 ? totalSimilarity / pairs : 0;
  }

  async suggestMerge(group: DuplicateGroup): Promise<MergeSuggestion> {
    if (group.tasks.length < 2) {
      throw new Error("Need at least 2 tasks to suggest a merge");
    }

    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

    const context: AIContext = {
      activeProjectId,
      projects,
      priorities,
    };

    try {
      return await aiService.suggestMerge(group, context);
    } catch (error) {
      console.error("AI merge suggestion failed, using heuristic:", error);
      return this.heuristicMergeSuggestion(group);
    }
  }

  private heuristicMergeSuggestion(group: DuplicateGroup): MergeSuggestion {
    const sorted = [...group.tasks].sort((a, b) => {
      const aHasSubtasks = a.subtasks.length > 0 ? 1 : 0;
      const bHasSubtasks = b.subtasks.length > 0 ? 1 : 0;
      if (aHasSubtasks !== bHasSubtasks) return bHasSubtasks - aHasSubtasks;
      const aHasActivity = a.activity?.length ?? 0;
      const bHasActivity = b.activity?.length ?? 0;
      return bHasActivity - aHasActivity;
    });

    const keepTask = sorted[0];
    const archiveTasks = sorted.slice(1);

    const allSubtasks = [
      ...keepTask.subtasks,
      ...archiveTasks.flatMap((t) =>
        t.subtasks.filter(
          (st) =>
            !keepTask.subtasks.some((kst) => kst.title.toLowerCase() === st.title.toLowerCase()),
        ),
      ),
    ];

    const allTags = Array.from(new Set([...keepTask.tags, ...archiveTasks.flatMap((t) => t.tags)]));

    const mergedSummary =
      keepTask.summary +
      "\n\n---\nMerged from duplicates:\n" +
      archiveTasks.map((t) => `- ${t.title}: ${t.summary}`).join("\n");

    return {
      keepTaskId: keepTask.id,
      archiveTaskIds: archiveTasks.map((t) => t.id),
      mergedFields: {
        subtasks: allSubtasks,
        tags: allTags,
        summary: mergedSummary,
        timeEstimate: Math.max(keepTask.timeEstimate, ...archiveTasks.map((t) => t.timeEstimate)),
        timeSpent: keepTask.timeSpent + archiveTasks.reduce((sum, t) => sum + t.timeSpent, 0),
      },
      reasoning: `Kept "${keepTask.title}" (most complete). Merged ${archiveTasks.length} duplicate(s).`,
    };
  }

  async executeMerge(
    suggestion: MergeSuggestion,
    onArchiveTask: (taskId: string) => void,
  ): Promise<void> {
    const { keepTaskId: _keepTaskId, archiveTaskIds, mergedFields: _mergedFields } = suggestion;

    for (const taskId of archiveTaskIds) {
      onArchiveTask(taskId);
    }

    console.log(`Merge complete: kept ${_keepTaskId}, archived ${archiveTaskIds.join(", ")}`);
  }

  async analyzeRedundancy(allTasks: Task[]): Promise<RedundancyAnalysis[]> {
    const analyses: RedundancyAnalysis[] = [];
    const completedTasks = allTasks.filter((t) => t.status === "completed" || t.completedAt);
    const activeTasks = allTasks.filter((t) => t.status !== "completed" && !t.completedAt);
    const now = new Date();

    for (const task of activeTasks) {
      for (const completed of completedTasks) {
        const similarity = this.calculateTitleSimilarity(task.title, completed.title);
        if (similarity > 0.7) {
          analyses.push({
            taskId: task.id,
            type: "completed-overlap",
            relatedTaskId: completed.id,
            confidence: similarity,
            reasoning: `Task "${task.title}" overlaps with completed task "${completed.title}" (${Math.round(similarity * 100)}% similar)`,
            suggestedAction: "archive",
          });
        }
      }

      const subtaskOf = activeTasks.find(
        (other) =>
          other.id !== task.id &&
          other.subtasks.some((st) => st.title.toLowerCase() === task.title.toLowerCase()),
      );

      if (subtaskOf) {
        analyses.push({
          taskId: task.id,
          type: "subset",
          relatedTaskId: subtaskOf.id,
          confidence: 0.9,
          reasoning: `Task "${task.title}" appears to be a subtask of "${subtaskOf.title}"`,
          suggestedAction: "convert-to-subtask",
        });
      }

      const isStale = this.isTaskStale(task, now);
      if (isStale) {
        analyses.push({
          taskId: task.id,
          type: "stale",
          confidence: 0.8,
          reasoning: `Task "${task.title}" is stale: no recent activity, past due date, low priority`,
          suggestedAction: "archive",
        });
      }

      const blockedByCompleted = task.links?.some(
        (link) =>
          link.type === "blocked-by" && completedTasks.some((ct) => ct.id === link.targetTaskId),
      );

      if (blockedByCompleted) {
        analyses.push({
          taskId: task.id,
          type: "blocked-completed",
          confidence: 0.85,
          reasoning: `Task "${task.title}" was blocked by a task that is now completed`,
          suggestedAction: "update",
        });
      }
    }

    return analyses;
  }

  private isTaskStale(task: Task, now: Date): boolean {
    const daysSinceUpdate = task.updatedAt
      ? (now.getTime() - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      : (now.getTime() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60 * 24);

    const isPastDue = task.dueDate ? new Date(task.dueDate) < now : false;
    const isLowPriority = task.priority === "low";
    const noRecentActivity = daysSinceUpdate > 30;

    return isPastDue && isLowPriority && noRecentActivity;
  }

  async categorizeTasks(allTasks: Task[]): Promise<AICategorySuggestion[]> {
    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

    const context: AIContext = {
      activeProjectId,
      projects,
      priorities,
    };

    try {
      return await aiService.categorizeTasks(allTasks, context);
    } catch (error) {
      console.error("AI categorization failed:", error);
      return this.heuristicCategorization(allTasks);
    }
  }

  private heuristicCategorization(allTasks: Task[]): AICategorySuggestion[] {
    return allTasks.map((task) => {
      const suggestedTags = this.extractTagsFromContent(task);
      const suggestedPriority = this.suggestPriority(task);

      return {
        taskId: task.id,
        suggestedTags,
        suggestedPriority,
        confidence: 0.6,
        reasoning: "Heuristic categorization based on content analysis",
      };
    });
  }

  private extractTagsFromContent(task: Task): string[] {
    const content = `${task.title} ${task.summary} ${task.tags.join(" ")}`.toLowerCase();
    const tagPatterns = [
      "bug",
      "feature",
      "enhancement",
      "documentation",
      "testing",
      "design",
      "review",
      "research",
      "deployment",
      "refactor",
      "urgent",
      "backend",
      "frontend",
      "api",
      "database",
      "ui",
      "ux",
    ];

    return tagPatterns.filter((tag) => content.includes(tag));
  }

  private suggestPriority(task: Task): string {
    if (task.dueDate) {
      const daysUntilDue = (new Date(task.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilDue < 2) return "high";
      if (daysUntilDue < 7) return "medium";
    }

    if (task.links?.some((l) => l.type === "blocks")) return "high";

    return task.priority || "medium";
  }

  async clusterTasks(allTasks: Task[]): Promise<TaskCluster[]> {
    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

    const context: AIContext = {
      activeProjectId,
      projects,
      priorities,
    };

    try {
      return await aiService.clusterTasks(allTasks, context);
    } catch (error) {
      console.error("AI clustering failed:", error);
      return this.heuristicClustering(allTasks);
    }
  }

  private heuristicClustering(allTasks: Task[]): TaskCluster[] {
    const clusters: TaskCluster[] = [];
    const processed = new Set<string>();

    for (const task of allTasks) {
      if (processed.has(task.id)) continue;

      const clusterTasks = [task.id];
      processed.add(task.id);

      const taskWords = new Set(task.title.toLowerCase().split(/\s+/));

      for (const other of allTasks) {
        if (processed.has(other.id)) continue;

        const otherWords = new Set(other.title.toLowerCase().split(/\s+/));
        const overlap = [...taskWords].filter((w) => otherWords.has(w)).length;

        if (overlap >= 2) {
          clusterTasks.push(other.id);
          processed.add(other.id);
        }
      }

      if (clusterTasks.length > 1) {
        const commonTags = new Set<string>();
        clusterTasks.forEach((id) => {
          const t = allTasks.find((task) => task.id === id);
          t?.tags.forEach((tag) => {
            commonTags.add(tag);
          });
        });

        clusters.push({
          id: `cluster-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          taskIds: clusterTasks,
          theme: clusterTasks
            .map((id) => allTasks.find((t) => t.id === id)?.title ?? "")
            .join(", "),
          suggestedTags: [...commonTags],
          confidence: 0.65,
        });
      }
    }

    return clusters;
  }
}

export const taskCleanupService = TaskCleanupService.getInstance();
export default taskCleanupService;
