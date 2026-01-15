import { Task } from '../../types';

interface SearchIndex {
    titleIndex: Map<string, Set<string>>; // word -> taskIds
    tagIndex: Map<string, Set<string>>;
    assigneeIndex: Map<string, Set<string>>;
    jobIdIndex: Map<string, Set<string>>;
    summaryIndex: Map<string, Set<string>>;
}

export class SearchIndexService {
    private index: SearchIndex = {
        titleIndex: new Map(),
        tagIndex: new Map(),
        assigneeIndex: new Map(),
        jobIdIndex: new Map(),
        summaryIndex: new Map(),
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
        };

        tasks.forEach(task => {
            // Index title words
            this.tokenize(task.title).forEach(word => {
                if (!this.index.titleIndex.has(word)) {
                    this.index.titleIndex.set(word, new Set());
                }
                this.index.titleIndex.get(word)!.add(task.id);
            });

            // Index jobId
            const jobIdLower = task.jobId.toLowerCase();
            if (!this.index.jobIdIndex.has(jobIdLower)) {
                this.index.jobIdIndex.set(jobIdLower, new Set());
            }
            this.index.jobIdIndex.get(jobIdLower)!.add(task.id);

            // Index tags
            task.tags.forEach(tag => {
                const tagLower = tag.toLowerCase();
                if (!this.index.tagIndex.has(tagLower)) {
                    this.index.tagIndex.set(tagLower, new Set());
                }
                this.index.tagIndex.get(tagLower)!.add(task.id);
            });

            // Index assignee
            if (task.assignee) {
                const assigneeLower = task.assignee.toLowerCase();
                if (!this.index.assigneeIndex.has(assigneeLower)) {
                    this.index.assigneeIndex.set(assigneeLower, new Set());
                }
                this.index.assigneeIndex.get(assigneeLower)!.add(task.id);
            }

            // Index summary
            if (task.summary) {
                this.tokenize(task.summary).forEach(word => {
                    if (!this.index.summaryIndex.has(word)) {
                        this.index.summaryIndex.set(word, new Set());
                    }
                    this.index.summaryIndex.get(word)!.add(task.id);
                });
            }
        });
    }

    /**
     * Search using index
     */
    search(query: string): string[] {
        if (!query.trim()) return [];

        const words = this.tokenize(query);
        if (words.length === 0) return [];

        // Get matches for each word
        const resultSets = words.map(word => {
            const matches = new Set<string>();

            // Search in all indexes
            this.index.titleIndex.get(word)?.forEach(id => matches.add(id));
            this.index.tagIndex.get(word)?.forEach(id => matches.add(id));
            this.index.assigneeIndex.get(word)?.forEach(id => matches.add(id));
            this.index.summaryIndex.get(word)?.forEach(id => matches.add(id));
            
            // Exact jobId match
            if (this.index.jobIdIndex.has(word)) {
                this.index.jobIdIndex.get(word)?.forEach(id => matches.add(id));
            }

            // Partial jobId match
            this.index.jobIdIndex.forEach((taskIds, jobId) => {
                if (jobId.includes(word)) {
                    taskIds.forEach(id => matches.add(id));
                }
            });

            return matches;
        });

        // Intersect result sets (AND logic - all words must match)
        if (resultSets.length === 0) return [];
        
        return Array.from(resultSets.reduce((acc, set) => {
            return new Set([...acc].filter(id => set.has(id)));
        }));
    }

    /**
     * Search with regex support
     */
    searchWithRegex(pattern: string): string[] {
        try {
            const regex = new RegExp(pattern, 'i');
            const matches = new Set<string>();

            // Search in title index
            this.index.titleIndex.forEach((taskIds, word) => {
                if (regex.test(word)) {
                    taskIds.forEach(id => matches.add(id));
                }
            });

            // Search in jobId index
            this.index.jobIdIndex.forEach((taskIds, jobId) => {
                if (regex.test(jobId)) {
                    taskIds.forEach(id => matches.add(id));
                }
            });

            return Array.from(matches);
        } catch (e) {
            // Invalid regex, fall back to normal search
            return this.search(pattern);
        }
    }

    /**
     * Tokenize text into searchable words
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .split(/\s+/)
            .map(word => word.replace(/[^\w]/g, ''))
            .filter(word => word.length > 2); // Only words with 3+ characters
    }

    /**
     * Update index for a single task (incremental update)
     */
    updateTask(task: Task, oldTask?: Task): void {
        // Remove old task from index
        if (oldTask) {
            this.removeTask(oldTask);
        }

        // Add new task to index
        this.addTask(task);
    }

    /**
     * Remove task from index
     */
    removeTask(task: Task): void {
        this.tokenize(task.title).forEach(word => {
            this.index.titleIndex.get(word)?.delete(task.id);
        });

        task.tags.forEach(tag => {
            this.index.tagIndex.get(tag.toLowerCase())?.delete(task.id);
        });

        if (task.assignee) {
            this.index.assigneeIndex.get(task.assignee.toLowerCase())?.delete(task.id);
        }

        this.index.jobIdIndex.get(task.jobId.toLowerCase())?.delete(task.id);

        if (task.summary) {
            this.tokenize(task.summary).forEach(word => {
                this.index.summaryIndex.get(word)?.delete(task.id);
            });
        }
    }

    /**
     * Add task to index
     */
    private addTask(task: Task): void {
        this.tokenize(task.title).forEach(word => {
            if (!this.index.titleIndex.has(word)) {
                this.index.titleIndex.set(word, new Set());
            }
            this.index.titleIndex.get(word)!.add(task.id);
        });

        task.tags.forEach(tag => {
            const tagLower = tag.toLowerCase();
            if (!this.index.tagIndex.has(tagLower)) {
                this.index.tagIndex.set(tagLower, new Set());
            }
            this.index.tagIndex.get(tagLower)!.add(task.id);
        });

        if (task.assignee) {
            const assigneeLower = task.assignee.toLowerCase();
            if (!this.index.assigneeIndex.has(assigneeLower)) {
                this.index.assigneeIndex.set(assigneeLower, new Set());
            }
            this.index.assigneeIndex.get(assigneeLower)!.add(task.id);
        }

        const jobIdLower = task.jobId.toLowerCase();
        if (!this.index.jobIdIndex.has(jobIdLower)) {
            this.index.jobIdIndex.set(jobIdLower, new Set());
        }
        this.index.jobIdIndex.get(jobIdLower)!.add(task.id);

        if (task.summary) {
            this.tokenize(task.summary).forEach(word => {
                if (!this.index.summaryIndex.has(word)) {
                    this.index.summaryIndex.set(word, new Set());
                }
                this.index.summaryIndex.get(word)!.add(task.id);
            });
        }
    }

    /**
     * Get index statistics
     */
    getStats(): {
        totalWords: number;
        totalTags: number;
        totalAssignees: number;
        totalJobIds: number;
    } {
        return {
            totalWords: this.index.titleIndex.size + this.index.summaryIndex.size,
            totalTags: this.index.tagIndex.size,
            totalAssignees: this.index.assigneeIndex.size,
            totalJobIds: this.index.jobIdIndex.size,
        };
    }
}

// Singleton instance
export const searchIndexService = new SearchIndexService();
