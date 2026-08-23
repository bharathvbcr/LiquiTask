import type {
  AICategorySuggestion,
  AIContext,
  DuplicateGroup,
  MergeSuggestion,
  PriorityDefinition,
  Project,
  RedundancyAnalysis,
  Subtask,
  Task,
  TaskCluster,
} from "../../types";
import { STORAGE_KEYS } from "../constants";
import { asString } from "../utils/coerce";
import { isTerminalTaskStatus } from "../utils/taskUtils";
import { validateMergeSuggestion } from "../utils/aiModalTrust";
import { toCoreTask } from "../runtime/coreDto";
import { callNative } from "../runtime/runtimeEnvironment";
import { aiService } from "./aiService";
import storageService from "./storageService";

/**
 * Structural (id-free) shapes returned by the `liquitask-core` Rust commands.
 *
 * The Rust core computes only deterministic structural data — task-id
 * groupings, confidences, reasoning, suggested actions, merged fields — WITHOUT
 * the random `id`/`reasons` fields the original assembled with `Date.now()` /
 * `Math.random()`. Those non-deterministic expressions are regenerated here in
 * TS (see the assemblers below) so the id formats stay byte-for-byte identical
 * while the heuristic computation runs natively.
 */
interface CoreDuplicateGroup {
  taskIds: string[];
  confidence: number;
}

interface CoreMergeSuggestion {
  keepTaskId: string;
  archiveTaskIds: string[];
  mergedFields: {
    subtasks: Subtask[];
    tags: string[];
    summary: string;
    timeEstimate: number;
    timeSpent: number;
  };
  reasoning: string;
}

interface CoreCategorySuggestion {
  taskId: string;
  suggestedTags: string[];
  suggestedPriority: string;
  confidence: number;
  reasoning: string;
}

interface CoreTaskCluster {
  taskIds: string[];
  theme: string;
  suggestedTags: string[];
  confidence: number;
}

class TaskCleanupService {
  private static instance: TaskCleanupService;

  static getInstance(): TaskCleanupService {
    if (!TaskCleanupService.instance) {
      TaskCleanupService.instance = new TaskCleanupService();
    }
    return TaskCleanupService.instance;
  }

  async detectDuplicates(
    allTasks: Task[],
    threshold: number = 0.75,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<DuplicateGroup[]> {
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
        // Pre-filter: only send pairs with meaningful title similarity to the AI.
        // Using the same Jaccard-based heuristic as heuristicDuplicateDetection so that
        // the AI is not flooded with O(n²) same-project comparisons.
        const titleSimilarity = this.calculateTitleSimilarity(t1.title, t2.title);
        const tagOverlap = this.calculateTagOverlap(t1.tags, t2.tags);
        const heuristicScore = titleSimilarity * 0.7 + tagOverlap * 0.3;
        if (heuristicScore >= threshold * 0.5) {
          taskPairs.push({ task1: t1, task2: t2 });
        }
      }
    }

    if (taskPairs.length === 0) return [];

    const duplicateGroups: DuplicateGroup[] = [];
    const processedTaskIds = new Set<string>();

    try {
      const results = await aiService.detectDuplicates(taskPairs, context, onProgress);

      for (const result of results) {
        if (result.confidence >= threshold) {
          const tasksInGroup = [result.task1, result.task2].filter(
            (t) => !processedTaskIds.has(t.id),
          );

          if (tasksInGroup.length > 1) {
            duplicateGroups.push({
              id: `dup-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
      // Native (Rust) heuristic on the desktop build; identical JS heuristic on
      // the web/PWA build (proven equivalent by the differential oracle).
      return this.heuristicDuplicateDetectionNative(allTasks, threshold);
    }

    return duplicateGroups;
  }

  /**
   * Rust-backed duplicate detection. The `cleanup_heuristic_duplicates` command
   * returns id-free `{ taskIds, confidence }` groups; this method assembles the
   * final `DuplicateGroup[]`, generating the `dup-heuristic-*` ids and the fixed
   * `reasons` exactly as the original JS did. On the web build (or if the native
   * call throws) it degrades to the pure JS `heuristicDuplicateDetection`.
   */
  private async heuristicDuplicateDetectionNative(
    allTasks: Task[],
    threshold: number,
  ): Promise<DuplicateGroup[]> {
    const groups = await callNative<CoreDuplicateGroup[]>(
      "cleanup_heuristic_duplicates",
      { tasks: allTasks.map(toCoreTask), threshold },
      () =>
        // Web fallback: reuse the existing JS heuristic, projected to the
        // structural shape so a single assembler generates the ids.
        this.heuristicDuplicateDetection(allTasks, threshold).map((g) => ({
          taskIds: g.tasks.map((t) => t.id),
          confidence: g.confidence,
        })),
    );

    const byId = new Map(allTasks.map((t) => [t.id, t]));
    return groups.map((g) => ({
      id: `dup-heuristic-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      tasks: g.taskIds.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined),
      confidence: g.confidence,
      reasons: ["Heuristic match: similar titles and/or tags"],
    }));
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
          id: `dup-heuristic-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
      const suggestion = await aiService.suggestMerge(group, context);
      return validateMergeSuggestion(group, suggestion) ?? this.heuristicMergeSuggestionNative(group);
    } catch (error) {
      console.error("AI merge suggestion failed, using heuristic:", error);
      return this.heuristicMergeSuggestionNative(group);
    }
  }

  /**
   * Rust-backed merge suggestion. `cleanup_heuristic_merge` returns the
   * deterministic keep/archive ids, merged fields and reasoning; the shape maps
   * 1:1 to `MergeSuggestion` (no random ids here), so we return it directly. On
   * the web build (or native failure) it degrades to the JS heuristic.
   */
  private async heuristicMergeSuggestionNative(group: DuplicateGroup): Promise<MergeSuggestion> {
    const result = await callNative<CoreMergeSuggestion>(
      "cleanup_heuristic_merge",
      { tasks: group.tasks.map(toCoreTask) },
      () => {
        // Web fallback: reuse the existing JS heuristic, projected to the
        // structural Core shape (its `mergedFields` is typed `Partial<Task>`,
        // but the heuristic always populates exactly these five fields).
        const s = this.heuristicMergeSuggestion(group);
        return {
          keepTaskId: s.keepTaskId,
          archiveTaskIds: s.archiveTaskIds,
          mergedFields: {
            subtasks: s.mergedFields.subtasks ?? [],
            tags: s.mergedFields.tags ?? [],
            summary: s.mergedFields.summary ?? "",
            timeEstimate: s.mergedFields.timeEstimate ?? 0,
            timeSpent: s.mergedFields.timeSpent ?? 0,
          },
          reasoning: s.reasoning,
        };
      },
    );

    return {
      keepTaskId: result.keepTaskId,
      archiveTaskIds: result.archiveTaskIds,
      mergedFields: {
        subtasks: result.mergedFields.subtasks,
        tags: result.mergedFields.tags,
        summary: result.mergedFields.summary,
        timeEstimate: result.mergedFields.timeEstimate,
        timeSpent: result.mergedFields.timeSpent,
      },
      reasoning: result.reasoning,
    };
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
            !keepTask.subtasks.some(
              (kst) => asString(kst.title).toLowerCase() === asString(st.title).toLowerCase(),
            ),
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
    allowedTaskIds?: Set<string>,
  ): Promise<void> {
    const { keepTaskId, archiveTaskIds } = suggestion;

    for (const taskId of archiveTaskIds) {
      if (taskId === keepTaskId) continue;
      if (allowedTaskIds && !allowedTaskIds.has(taskId)) continue;
      onArchiveTask(taskId);
    }
  }

  /**
   * Redundancy analysis. This method has NO AI path — it is fully deterministic —
   * so the whole body delegates to the `cleanup_analyze_redundancy` Rust command
   * (with `nowMs` supplying the reference clock) and falls back to the identical
   * JS implementation on the web build. The command's output already matches the
   * `RedundancyAnalysis` shape 1:1 (no ids), so it is returned directly.
   */
  async analyzeRedundancy(allTasks: Task[]): Promise<RedundancyAnalysis[]> {
    const nowMs = Date.now();
    return callNative<RedundancyAnalysis[]>(
      "cleanup_analyze_redundancy",
      { tasks: allTasks.map(toCoreTask), nowMs },
      () => this.analyzeRedundancyJs(allTasks, new Date(nowMs)),
    );
  }

  /** Pure JS redundancy analysis (web fallback). `now` replaces `new Date()`. */
  private analyzeRedundancyJs(allTasks: Task[], now: Date): RedundancyAnalysis[] {
    const analyses: RedundancyAnalysis[] = [];
    const completedTasks = allTasks.filter(
      (t) => isTerminalTaskStatus(t.status) || t.completedAt,
    );
    const activeTasks = allTasks.filter(
      (t) => !isTerminalTaskStatus(t.status) && !t.completedAt,
    );

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
          other.subtasks.some(
            (st) => asString(st.title).toLowerCase() === asString(task.title).toLowerCase(),
          ),
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
      return this.heuristicCategorizationNative(allTasks);
    }
  }

  /**
   * Rust-backed categorization. `cleanup_heuristic_categorize` returns
   * `{ taskId, suggestedTags, suggestedPriority, confidence, reasoning }` per
   * task (no ids). `nowMs` replaces the original `Date.now()` the priority
   * heuristic read. Degrades to the JS heuristic on the web build.
   */
  private async heuristicCategorizationNative(allTasks: Task[]): Promise<AICategorySuggestion[]> {
    const nowMs = Date.now();
    const results = await callNative<CoreCategorySuggestion[]>(
      "cleanup_heuristic_categorize",
      { tasks: allTasks.map(toCoreTask), nowMs },
      () =>
        // Web fallback: reuse the existing JS heuristic, projected to the
        // structural Core shape (the heuristic always sets `suggestedPriority`).
        this.heuristicCategorization(allTasks, nowMs).map((c) => ({
          taskId: c.taskId,
          suggestedTags: c.suggestedTags,
          suggestedPriority: c.suggestedPriority ?? "medium",
          confidence: c.confidence,
          reasoning: c.reasoning,
        })),
    );

    return results.map((r) => ({
      taskId: r.taskId,
      suggestedTags: r.suggestedTags,
      suggestedPriority: r.suggestedPriority,
      confidence: r.confidence,
      reasoning: r.reasoning,
    }));
  }

  private heuristicCategorization(allTasks: Task[], nowMs: number = Date.now()): AICategorySuggestion[] {
    return allTasks.map((task) => {
      const suggestedTags = this.extractTagsFromContent(task);
      const suggestedPriority = this.suggestPriority(task, nowMs);

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

  private suggestPriority(task: Task, nowMs: number = Date.now()): string {
    if (task.dueDate) {
      const daysUntilDue = (new Date(task.dueDate).getTime() - nowMs) / (1000 * 60 * 60 * 24);
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
      return this.heuristicClusteringNative(allTasks);
    }
  }

  /**
   * Rust-backed clustering. `cleanup_heuristic_cluster` returns id-free
   * `{ taskIds, theme, suggestedTags, confidence }` clusters; this assembler
   * generates the `cluster-*` ids exactly as the original JS did. Degrades to
   * the JS heuristic on the web build.
   */
  private async heuristicClusteringNative(allTasks: Task[]): Promise<TaskCluster[]> {
    const clusters = await callNative<CoreTaskCluster[]>(
      "cleanup_heuristic_cluster",
      { tasks: allTasks.map(toCoreTask) },
      () =>
        this.heuristicClustering(allTasks).map((c) => ({
          taskIds: c.taskIds,
          theme: c.theme,
          suggestedTags: c.suggestedTags,
          confidence: c.confidence,
        })),
    );

    return clusters.map((c) => ({
      id: `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      taskIds: c.taskIds,
      theme: c.theme,
      suggestedTags: c.suggestedTags,
      confidence: c.confidence,
    }));
  }

  private heuristicClustering(allTasks: Task[]): TaskCluster[] {
    const clusters: TaskCluster[] = [];
    const processed = new Set<string>();

    for (const task of allTasks) {
      if (processed.has(task.id)) continue;

      const clusterTasks = [task.id];
      processed.add(task.id);

      const taskWords = new Set(asString(task.title).toLowerCase().split(/\s+/));

      for (const other of allTasks) {
        if (processed.has(other.id)) continue;

        const otherWords = new Set(asString(other.title).toLowerCase().split(/\s+/));
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
          id: `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
