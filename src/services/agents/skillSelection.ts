/**
 * Relevance-ranked skill selection for agent runs.
 *
 * The run path used to inject only the newest-N *captured* skills for a repo,
 * ignoring task relevance and ignoring installed skill FILES entirely (they were
 * display-only in the library). This module scores a merged catalog (captured +
 * installed) against the task and returns the best matches, so every run — not
 * just DevCouncil council runs — gets the knowledge that actually fits the work.
 *
 * Policy:
 *  - captured skills stay eligible even with no keyword overlap (repo-specific,
 *    and this preserves the prior "always surface some team knowledge" behavior);
 *  - installed skills appear ONLY when they match the task, so generic skill packs
 *    don't flood the prompt;
 *  - results are ordered by score, then captured-before-installed, then input order.
 */
import type { SkillCatalogEntry } from "../../core/skills";
import type { AgentSkill, Task } from "../../../types";

const DEFAULT_LIMIT = 5;

/** Generic words that carry no task signal (short words <3 chars are dropped too). */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "your",
  "are", "was", "were", "will", "not", "but", "has", "have", "had", "its",
  "out", "our", "then", "than", "them", "they", "you", "all", "any", "via",
]);

/** Lowercase alphanumeric tokens, minus stopwords and 1-2 char noise. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );
}

/** The set of meaningful tokens describing a task (title/subtitle/summary/tags). */
export function taskQueryTokens(task: Task): Set<string> {
  const parts = [task.title, task.subtitle, task.summary, ...(task.tags ?? [])].filter(
    Boolean,
  ) as string[];
  return new Set(tokenize(parts.join(" ")));
}

/** Overlap score: a title hit is worth more than a body hit. */
export function scoreEntry(entry: SkillCatalogEntry, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const titleTokens = new Set(tokenize(entry.title));
  const summaryTokens = new Set(tokenize(entry.summary));
  let score = 0;
  for (const q of queryTokens) {
    if (titleTokens.has(q)) score += 2;
    else if (summaryTokens.has(q)) score += 1;
  }
  return score;
}

/** Rank a merged catalog against a task and return the top `limit` entries. */
export function selectSkillsForTask(
  task: Task,
  catalog: SkillCatalogEntry[],
  limit: number = DEFAULT_LIMIT,
): SkillCatalogEntry[] {
  const query = taskQueryTokens(task);
  const scored = catalog.map((entry, index) => ({
    entry,
    index,
    score: scoreEntry(entry, query),
  }));

  // Captured skills are always eligible; installed ones must actually match.
  const eligible = scored.filter((s) => s.entry.origin === "captured" || s.score > 0);

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.entry.origin !== b.entry.origin) return a.entry.origin === "captured" ? -1 : 1;
    return a.index - b.index;
  });

  return eligible.slice(0, limit).map((s) => s.entry);
}

/**
 * Skill set for a single run: an agent's pinned skills always win, then the
 * best task-relevant matches fill the rest. Pinned entries are prepended in
 * catalog order (their `id` appears in `pinnedIds`); the remaining catalog is
 * relevance-ranked via `selectSkillsForTask`. Unknown pinned ids are simply
 * absent from the catalog, so a deleted skill degrades safely to none.
 */
export function selectRunSkills(
  task: Task,
  catalog: SkillCatalogEntry[],
  pinnedIds: readonly string[] = [],
  limit: number = DEFAULT_LIMIT,
): SkillCatalogEntry[] {
  const pinnedSet = new Set(pinnedIds);
  const pinned = catalog.filter((entry) => pinnedSet.has(entry.id));
  const rest = catalog.filter((entry) => !pinnedSet.has(entry.id));
  const ranked = selectSkillsForTask(task, rest, limit);

  const seen = new Set<string>();
  const combined: SkillCatalogEntry[] = [];
  for (const entry of [...pinned, ...ranked]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    combined.push(entry);
  }
  return combined;
}

/**
 * Adapt a catalog entry to the `AgentSkill` shape the prompt builders consume.
 * Only title/summary are rendered; `agentId` carries the origin for traceability.
 */
export function catalogEntryToSkill(entry: SkillCatalogEntry): AgentSkill {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    workingDir: entry.workingDir ?? "",
    taskId: "",
    agentId: entry.origin,
    createdAt: new Date(),
  };
}
