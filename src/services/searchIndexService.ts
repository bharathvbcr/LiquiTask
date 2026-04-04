import type { Task } from "../../types";

interface SearchIndex {
  titleIndex: Map<string, Set<string>>; // word -> taskIds
  tagIndex: Map<string, Set<string>>;
  assigneeIndex: Map<string, Set<string>>;
  jobIdIndex: Map<string, Set<string>>;
  summaryIndex: Map<string, Set<string>>;
  semanticIndex: Map<string, Set<string>>; // AI-generated concepts -> taskIds
}

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
   * Build search index from tasks
   */
  buildIndex(tasks: Task[]): void {
    // Clear existing index
    this.index = {
      titleIndex: new Map(),
      tagIndex: new Map(),
      assigneeIndex: new Map(),
      jobIdIndex: new Map(),
      summaryIndex: new Map(),
      semanticIndex: new Map(),
    };

    tasks.forEach((task) => {
      this.addTask(task);
    });
  }

  /**
   * AI-Augmented Hybrid Search
   */
  search(query: string): string[] {
    if (!query.trim()) return [];

    const words = this.tokenize(query);
    if (words.length === 0) {
      const results = new Set<string>();
      const lowerQuery = query.toLowerCase().trim();
      this.index.jobIdIndex.forEach((taskIds, jobId) => {
        if (jobId.includes(lowerQuery)) {
          taskIds.forEach((id) => results.add(id));
        }
      });
      return Array.from(results);
    }

    // Get matches for each word
    const resultSets = words.map((word) => {
      const matches = new Set<string>();

      // Exact matches (High weight)
      this.index.titleIndex.get(word)?.forEach((id) => matches.add(id));
      this.index.tagIndex.get(word)?.forEach((id) => matches.add(id));
      this.index.assigneeIndex.get(word)?.forEach((id) => matches.add(id));
      
      // Partial matches & Semantic matches (Medium weight)
      this.index.summaryIndex.get(word)?.forEach((id) => matches.add(id));
      this.index.semanticIndex.get(word)?.forEach((id) => matches.add(id));

      if (this.index.jobIdIndex.has(word)) {
        this.index.jobIdIndex.get(word)?.forEach((id) => matches.add(id));
      }

      // Check partial jobId matches
      this.index.jobIdIndex.forEach((ids, jobId) => {
        if (jobId.includes(word)) {
          ids.forEach(id => matches.add(id));
        }
      });

      return matches;
    });

    // Intersect result sets (AND logic)
    let intersection = resultSets[0] ?? new Set<string>();
    for (let i = 1; i < resultSets.length; i++) {
      intersection = new Set([...intersection].filter((id) => resultSets[i].has(id)));
    }

    // If intersection is small, boost with OR-based semantic fuzzy matching
    if (intersection.size < 3) {
      words.forEach(word => {
        this.index.semanticIndex.get(word)?.forEach(id => intersection.add(id));
      });
    }

    return Array.from(intersection);
  }

  /**
   * Update semantic keywords via AI
   */
  async augmentTaskSemantically(task: Task, aiService: any, context: any): Promise<void> {
    try {
      const keywords = await aiService.generateSemanticKeywords(task, context);
      keywords.forEach((keyword: string) => {
        const normalized = keyword.toLowerCase().trim();
        if (!this.index.semanticIndex.has(normalized)) {
          this.index.semanticIndex.set(normalized, new Set());
        }
        this.index.semanticIndex.get(normalized)?.add(task.id);
      });
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

      // Helper to check map
      const checkMap = (map: Map<string, Set<string>>) => {
        map.forEach((ids, key) => {
          if (regex.test(key)) {
            ids.forEach((id) => results.add(id));
          }
        });
      };

      checkMap(this.index.titleIndex);
      checkMap(this.index.jobIdIndex);
      checkMap(this.index.tagIndex);
      checkMap(this.index.assigneeIndex);
      checkMap(this.index.summaryIndex);

      return Array.from(results);
    } catch {
      return this.search(pattern);
    }
  }

  /**
   * Add task to index
   */
  private addTask(task: Task): void {
    // Title
    this.tokenize(task.title).forEach((word) => {
      if (!this.index.titleIndex.has(word)) this.index.titleIndex.set(word, new Set());
      this.index.titleIndex.get(word)?.add(task.id);
    });

    // Tags
    task.tags.forEach((tag) => {
      const tagLower = tag.toLowerCase().trim();
      if (!this.index.tagIndex.has(tagLower)) this.index.tagIndex.set(tagLower, new Set());
      this.index.tagIndex.get(tagLower)?.add(task.id);
    });

    // Assignee
    if (task.assignee) {
      this.tokenize(task.assignee).forEach((word) => {
        if (!this.index.assigneeIndex.has(word)) this.index.assigneeIndex.set(word, new Set());
        this.index.assigneeIndex.get(word)?.add(task.id);
      });
    }

    // JobId
    if (task.jobId) {
      const jobIdLower = task.jobId.toLowerCase().trim();
      if (!this.index.jobIdIndex.has(jobIdLower)) this.index.jobIdIndex.set(jobIdLower, new Set());
      this.index.jobIdIndex.get(jobIdLower)?.add(task.id);
    }

    // Summary
    if (task.summary) {
      this.tokenize(task.summary).forEach((word) => {
        if (!this.index.summaryIndex.has(word)) this.index.summaryIndex.set(word, new Set());
        this.index.summaryIndex.get(word)?.add(task.id);
      });
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
    const removeFromMap = (map: Map<string, Set<string>>) => {
      map.forEach((ids, key) => {
        ids.delete(task.id);
        if (ids.size === 0) {
          map.delete(key);
        }
      });
    };

    removeFromMap(this.index.titleIndex);
    removeFromMap(this.index.tagIndex);
    removeFromMap(this.index.assigneeIndex);
    removeFromMap(this.index.jobIdIndex);
    removeFromMap(this.index.summaryIndex);
    removeFromMap(this.index.semanticIndex);
  }

  /**
   * Tokenize string into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,._-]+/)
      .filter((word) => word.length >= 2);
  }

  /**
   * Get formatted context for AI queries
   */
  getRelevantContext(query: string, allTasks: Task[], limit = 5): string {
    const matchedIds = this.search(query);
    const matchedTasks = allTasks.filter((t) => matchedIds.includes(t.id)).slice(0, limit);

    if (matchedTasks.length === 0) return "No relevant tasks found for the current query.";

    return matchedTasks
      .map((t) => {
        return `[Task ID: ${t.id}]
Title: ${t.title}
Status: ${t.status}
Priority: ${t.priority}
Tags: ${t.tags.join(", ")}
${t.summary ? `Summary: ${t.summary}` : ""}
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
    };
  }
}

export const searchIndexService = new SearchIndexService();
