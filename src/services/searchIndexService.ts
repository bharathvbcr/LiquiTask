import type { AIContext, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import storageService from "./storageService";

interface SearchIndex {
  titleIndex: Map<string, Set<string>>;
  tagIndex: Map<string, Set<string>>;
  assigneeIndex: Map<string, Set<string>>;
  jobIdIndex: Map<string, Set<string>>;
  summaryIndex: Map<string, Set<string>>;
  semanticIndex: Map<string, Set<string>>;
}

/** Reverse lookup: taskId -> tokens indexed in each forward index */
interface TaskTokenRecord {
  titleTokens: string[];
  tagTokens: string[];
  assigneeTokens: string[];
  jobIdTokens: string[];
  summaryTokens: string[];
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "how",
  "i",
  "is",
  "me",
  "my",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "what",
  "with",
]);

/** Maximum number of task entries kept in the semantic cache */
const MAX_SEMANTIC_CACHE_ENTRIES = 500;

/** Semantic cache entries older than this are discarded on load */
const SEMANTIC_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** In-memory representation: taskId -> keyword array (derived from persisted form) */
type SemanticCache = Record<string, string[]>;

/** Persisted representation: includes a timestamp for TTL enforcement */
interface PersistedSemanticCacheEntry {
  keywords: string[];
  timestamp: number;
}
type PersistedSemanticCache = Record<string, PersistedSemanticCacheEntry>;

type RelevantContextOptions = {
  limit?: number;
  projectId?: string;
};

type SemanticAiService = {
  generateSemanticKeywords: (task: Task, context: AIContext) => Promise<string[]>;
};

export class SearchIndexService {
  private index: SearchIndex = {
    titleIndex: new Map(),
    tagIndex: new Map(),
    assigneeIndex: new Map(),
    jobIdIndex: new Map(),
    summaryIndex: new Map(),
    semanticIndex: new Map(),
  };

  /**
   * Reverse lookup from taskId to the tokens that were added for that task.
   * Allows removeTask to delete only the relevant keys instead of scanning
   * every entry in each forward-index Map.
   */
  private taskTokens: Map<string, TaskTokenRecord> = new Map();

  private semanticCache: SemanticCache = {};

  /**
   * Build search index from tasks
   */
  buildIndex(tasks: Task[]): void {
    this.semanticCache = this.loadSemanticCache();
    this.resetIndex();

    tasks.forEach((task) => {
      this.addTask(task);
    });
  }

  /**
   * AI-Augmented Hybrid Search for exact task filtering.
   */
  search(query: string): string[] {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    const exactJobIdMatches = new Set<string>();
    if (this.index.jobIdIndex.has(lowerQuery)) {
      this.index.jobIdIndex.get(lowerQuery)?.forEach((id) => {
        exactJobIdMatches.add(id);
      });
    }

    const words = this.tokenize(query, { keepStopWords: true });
    if (words.length === 0) {
      this.index.jobIdIndex.forEach((taskIds, jobId) => {
        if (jobId.includes(lowerQuery)) {
          taskIds.forEach((id) => {
            exactJobIdMatches.add(id);
          });
        }
      });
      return Array.from(exactJobIdMatches);
    }

    const resultSets = words.map((word) => {
      const matches = new Set<string>();

      this.index.titleIndex.get(word)?.forEach((id) => {
        matches.add(id);
      });
      this.index.tagIndex.get(word)?.forEach((id) => {
        matches.add(id);
      });
      this.index.assigneeIndex.get(word)?.forEach((id) => {
        matches.add(id);
      });
      this.index.summaryIndex.get(word)?.forEach((id) => {
        matches.add(id);
      });
      this.index.semanticIndex.get(word)?.forEach((id) => {
        matches.add(id);
      });

      this.index.jobIdIndex.forEach((ids, jobId) => {
        if (jobId.includes(word)) {
          ids.forEach((id) => {
            matches.add(id);
          });
        }
      });

      return matches;
    });

    let intersection = resultSets[0] ?? new Set<string>();
    for (let i = 1; i < resultSets.length; i++) {
      intersection = new Set([...intersection].filter((id) => resultSets[i].has(id)));
    }

    if (intersection.size < 3) {
      words.forEach((word) => {
        this.index.semanticIndex.get(word)?.forEach((id) => {
          intersection.add(id);
        });
      });
    }

    exactJobIdMatches.forEach((id) => {
      intersection.add(id);
    });
    return Array.from(intersection);
  }

  /**
   * Update semantic keywords via AI and persist them for future sessions.
   */
  async augmentTaskSemantically(
    task: Task,
    aiService: SemanticAiService,
    context: AIContext,
  ): Promise<void> {
    try {
      const keywords = await aiService.generateSemanticKeywords(task, context);
      this.setSemanticKeywords(task.id, keywords);
    } catch (e) {
      console.error("Semantic augmentation failed:", e);
    }
  }

  /**
   * Search with regex support
   */
  searchWithRegex(pattern: string): string[] {
    try {
      const regex = new RegExp(pattern, "i");
      const results = new Set<string>();

      const checkMap = (map: Map<string, Set<string>>) => {
        map.forEach((ids, key) => {
          if (regex.test(key)) {
            ids.forEach((id) => {
              results.add(id);
            });
          }
        });
      };

      checkMap(this.index.titleIndex);
      checkMap(this.index.jobIdIndex);
      checkMap(this.index.tagIndex);
      checkMap(this.index.assigneeIndex);
      checkMap(this.index.summaryIndex);
      checkMap(this.index.semanticIndex);

      return Array.from(results);
    } catch {
      return this.search(pattern);
    }
  }

  /**
   * Update task in index
   */
  updateTask(newTask: Task, oldTask?: Task): void {
    if (oldTask) {
      this.removeTask(oldTask);
    }
    this.addTask(newTask);
  }

  /**
   * Remove task from index
   */
  removeTask(task: Task): void {
    // Use the reverse index to remove only the tokens that belong to this task,
    // avoiding a full O(M) scan of every key in each forward-index Map.
    const removeFromMap = (map: Map<string, Set<string>>, tokens: string[]) => {
      for (const token of tokens) {
        const ids = map.get(token);
        if (ids) {
          ids.delete(task.id);
          if (ids.size === 0) {
            map.delete(token);
          }
        }
      }
    };

    const record = this.taskTokens.get(task.id);
    if (record) {
      removeFromMap(this.index.titleIndex, record.titleTokens);
      removeFromMap(this.index.tagIndex, record.tagTokens);
      removeFromMap(this.index.assigneeIndex, record.assigneeTokens);
      removeFromMap(this.index.jobIdIndex, record.jobIdTokens);
      removeFromMap(this.index.summaryIndex, record.summaryTokens);
      this.taskTokens.delete(task.id);
    }

    // Semantic tokens are tracked separately via clearSemanticKeywords
    if (this.semanticCache[task.id]) {
      this.clearSemanticKeywords(task.id);
      this.persistSemanticCache();
    }
  }

  /**
   * Clear the entire semantic keyword cache and remove it from storage.
   * Should be called when the user disables AI features.
   */
  clearSemanticCache(): void {
    // Remove all semantic index entries
    this.index.semanticIndex.clear();
    this.semanticCache = {};
    storageService.remove(STORAGE_KEYS.AI_SEMANTIC_CACHE);
  }

  /**
   * Get formatted, project-scoped context for AI queries.
   */
  getRelevantContext(
    query: string,
    allTasks: Task[],
    options: RelevantContextOptions = {},
  ): string {
    const { limit = 5, projectId } = options;
    const candidateTasks = projectId
      ? allTasks.filter((task) => task.projectId === projectId)
      : allTasks;
    const matchedTasks = this.rankTasksForContext(query, candidateTasks).slice(0, limit);

    if (matchedTasks.length === 0) {
      return "";
    }

    return matchedTasks
      .map((task) => {
        return `[Task ID: ${task.id}]
Title: ${task.title}
Status: ${task.status}
Priority: ${task.priority}
Tags: ${task.tags.join(", ")}
${task.summary ? `Summary: ${task.summary}` : ""}
---`;
      })
      .join("\n");
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      totalWords: this.index.titleIndex.size + this.index.summaryIndex.size,
      totalTags: this.index.tagIndex.size,
      totalAssignees: this.index.assigneeIndex.size,
      totalJobIds: this.index.jobIdIndex.size,
      totalSemanticKeywords: Object.values(this.semanticCache).reduce(
        (count, keywords) => count + keywords.length,
        0,
      ),
    };
  }

  private resetIndex(): void {
    this.index = {
      titleIndex: new Map(),
      tagIndex: new Map(),
      assigneeIndex: new Map(),
      jobIdIndex: new Map(),
      summaryIndex: new Map(),
      semanticIndex: new Map(),
    };
    this.taskTokens = new Map();
  }

  private addTask(task: Task): void {
    const titleTokens = this.tokenize(task.title, { keepStopWords: true });
    titleTokens.forEach((word) => {
      this.addToIndex(this.index.titleIndex, word, task.id);
    });

    const tagTokens: string[] = [];
    task.tags.forEach((tag) => {
      this.tokenize(tag, { keepStopWords: true }).forEach((word) => {
        tagTokens.push(word);
        this.addToIndex(this.index.tagIndex, word, task.id);
      });
    });

    const assigneeTokens: string[] = [];
    if (task.assignee) {
      this.tokenize(task.assignee, { keepStopWords: true }).forEach((word) => {
        assigneeTokens.push(word);
        this.addToIndex(this.index.assigneeIndex, word, task.id);
      });
    }

    const jobIdTokens: string[] = [];
    if (task.jobId) {
      const jobIdLower = task.jobId.toLowerCase().trim();
      jobIdTokens.push(jobIdLower);
      this.addToIndex(this.index.jobIdIndex, jobIdLower, task.id);
    }

    const summaryTokens: string[] = [];
    if (task.summary) {
      this.tokenize(task.summary, { keepStopWords: true }).forEach((word) => {
        summaryTokens.push(word);
        this.addToIndex(this.index.summaryIndex, word, task.id);
      });
    }

    // Record all tokens in the reverse index for O(k) removal later
    this.taskTokens.set(task.id, {
      titleTokens,
      tagTokens,
      assigneeTokens,
      jobIdTokens,
      summaryTokens,
    });

    (this.semanticCache[task.id] ?? []).forEach((keyword) => {
      this.addToIndex(this.index.semanticIndex, keyword, task.id);
    });
  }

  private addToIndex(map: Map<string, Set<string>>, key: string, taskId: string): void {
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key)?.add(taskId);
  }

  private tokenize(text: string, options: { keepStopWords?: boolean } = {}): string[] {
    const keepStopWords = options.keepStopWords ?? false;
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2 && (keepStopWords || !SEARCH_STOP_WORDS.has(word)));
  }

  private normalizeKeywords(keywords: string[]): string[] {
    return Array.from(
      new Set(keywords.flatMap((keyword) => this.tokenize(keyword)).filter(Boolean)),
    );
  }

  private setSemanticKeywords(taskId: string, keywords: string[]): void {
    const hadExistingKeywords = Boolean(this.semanticCache[taskId]?.length);
    this.clearSemanticKeywords(taskId);

    const normalizedKeywords = this.normalizeKeywords(keywords);
    if (normalizedKeywords.length === 0) {
      if (hadExistingKeywords) {
        this.persistSemanticCache();
      }
      return;
    }

    this.semanticCache[taskId] = normalizedKeywords;
    normalizedKeywords.forEach((keyword) => {
      this.addToIndex(this.index.semanticIndex, keyword, taskId);
    });
    this.persistSemanticCache();
  }

  private clearSemanticKeywords(taskId: string): void {
    const existingKeywords = this.semanticCache[taskId] ?? [];
    existingKeywords.forEach((keyword) => {
      const ids = this.index.semanticIndex.get(keyword);
      ids?.delete(taskId);
      if (ids && ids.size === 0) {
        this.index.semanticIndex.delete(keyword);
      }
    });
    delete this.semanticCache[taskId];
  }

  private loadSemanticCache(): SemanticCache {
    const cached = storageService.get<PersistedSemanticCache>(STORAGE_KEYS.AI_SEMANTIC_CACHE, {});
    if (!cached || typeof cached !== "object" || Array.isArray(cached)) {
      return {};
    }

    const now = Date.now();

    // Filter out entries that are missing a timestamp (legacy plain-array format)
    // or that have exceeded the TTL.
    const validEntries = Object.entries(cached).filter(([, entry]) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      return now - (entry.timestamp ?? 0) <= SEMANTIC_CACHE_TTL_MS;
    }) as [string, PersistedSemanticCacheEntry][];

    // Trim to the most-recent MAX_SEMANTIC_CACHE_ENTRIES entries.
    const trimmed =
      validEntries.length > MAX_SEMANTIC_CACHE_ENTRIES
        ? validEntries
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, MAX_SEMANTIC_CACHE_ENTRIES)
        : validEntries;

    return Object.fromEntries(
      trimmed.map(([taskId, entry]) => [
        taskId,
        Array.isArray(entry.keywords) ? this.normalizeKeywords(entry.keywords) : [],
      ]),
    );
  }

  private persistSemanticCache(): void {
    const persisted: PersistedSemanticCache = Object.fromEntries(
      Object.entries(this.semanticCache).map(([taskId, keywords]) => [
        taskId,
        { keywords, timestamp: Date.now() },
      ]),
    );
    storageService.set(STORAGE_KEYS.AI_SEMANTIC_CACHE, persisted);
  }

  private rankTasksForContext(query: string, tasks: Task[]): Task[] {
    const lowerQuery = query.toLowerCase().trim();
    const intentTerms = this.tokenize(query);
    const isTodayIntent = /\b(today|next|now)\b/i.test(lowerQuery);
    const isBlockerIntent = /\b(blocker|blocked|dependency|dependencies)\b/i.test(lowerQuery);

    const scoredTasks = tasks
      .map((task) => {
        const semanticKeywords = this.semanticCache[task.id] ?? [];
        const title = `${task.title} ${task.subtitle ?? ""}`.toLowerCase();
        const summary = task.summary.toLowerCase();
        const tags = task.tags.join(" ").toLowerCase();
        const assignee = task.assignee.toLowerCase();
        const jobId = task.jobId.toLowerCase();
        const semantic = semanticKeywords.join(" ");
        let score = 0;

        if (lowerQuery && jobId === lowerQuery) score += 14;
        if (lowerQuery && jobId.includes(lowerQuery)) score += 8;
        if (lowerQuery && title.includes(lowerQuery)) score += 7;
        if (lowerQuery && summary.includes(lowerQuery)) score += 5;
        if (lowerQuery && tags.includes(lowerQuery)) score += 5;
        if (lowerQuery && assignee.includes(lowerQuery)) score += 4;
        if (lowerQuery && semantic.includes(lowerQuery)) score += 4;

        intentTerms.forEach((term) => {
          if (this.index.titleIndex.get(term)?.has(task.id)) score += 3;
          if (this.index.tagIndex.get(term)?.has(task.id)) score += 3;
          if (this.index.assigneeIndex.get(term)?.has(task.id)) score += 2;
          if (this.index.summaryIndex.get(term)?.has(task.id)) score += 2;
          if (this.index.semanticIndex.get(term)?.has(task.id)) score += 2;
          if (jobId.includes(term)) score += 2;
        });

        if (isTodayIntent && !task.completedAt) {
          if (task.dueDate) {
            const dueDate = new Date(task.dueDate);
            const today = new Date();
            dueDate.setHours(0, 0, 0, 0);
            today.setHours(0, 0, 0, 0);
            if (dueDate.getTime() <= today.getTime()) score += 3;
          }
          if (task.priority === "high") score += 1;
        }

        if (isBlockerIntent && (task.links?.some((link) => link.type === "blocked-by") ?? false)) {
          score += 3;
        }

        return { task, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.task.title.localeCompare(b.task.title));

    return scoredTasks.map(({ task }) => task);
  }
}

export const searchIndexService = new SearchIndexService();
