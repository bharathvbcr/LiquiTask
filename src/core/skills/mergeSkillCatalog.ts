/**
 * Skills catalog — one list over two very different sources:
 *
 * - **captured** skills: run-history knowledge compounded by
 *   `agentSkillsService` (a completed run's task + summary, scoped to a repo).
 * - **installed** skills: skill FILES on disk (~/.claude/skills etc.)
 *   discovered by the agentd sidecar via `localApi.listSkills()`.
 *
 * Views should not care which side a skill came from, so this module merges
 * both into `SkillCatalogEntry[]` with a single `origin` discriminator.
 */
import type { AgentSkill } from "../../../types";

/** Mirrors one element of `localApi.listSkills()`'s return (agentd `skills.list`). */
export interface InstalledSkill {
  key: string;
  name: string;
  description?: string;
  source_path: string;
  provider: string;
  root?: string;
  file_count: number;
}

export type SkillOrigin = "captured" | "installed";

export interface SkillCatalogEntry {
  id: string;
  title: string;
  summary: string;
  origin: SkillOrigin;
  /** Installed only — which runtime's skill root it was found under. */
  provider?: string;
  /** Installed only — path to the skill on disk. */
  sourcePath?: string;
  /** Captured only — the repo the skill was learned in. */
  workingDir?: string;
}

/** Case/whitespace-insensitive title key used for cross-source dedupe. */
export function normalizeSkillTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge both skill sources into one catalog, deduped by normalized title.
 * Captured skills win a title collision: they carry repo-specific context
 * (workingDir + how the task was actually solved) that a bare skill file
 * doesn't. Within a source, first occurrence wins — agentSkillsService
 * persists captured skills newest-first, so the freshest capture survives.
 * Sorted by origin ("captured" before "installed") then title.
 */
export function mergeSkillCatalog(
  captured: AgentSkill[],
  installed: InstalledSkill[] | undefined,
): SkillCatalogEntry[] {
  const seen = new Set<string>();
  const entries: SkillCatalogEntry[] = [];

  for (const skill of captured) {
    const key = normalizeSkillTitle(skill.title);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      id: skill.id,
      title: skill.title,
      summary: skill.summary,
      origin: "captured",
      workingDir: skill.workingDir,
    });
  }

  for (const skill of installed ?? []) {
    const key = normalizeSkillTitle(skill.name);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      // `key` alone isn't unique across runtimes' skill roots; qualify by provider.
      id: `installed:${skill.provider}:${skill.key}`,
      title: skill.name,
      summary: skill.description ?? "",
      origin: "installed",
      provider: skill.provider,
      sourcePath: skill.source_path,
    });
  }

  return entries.sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.title.localeCompare(b.title),
  );
}
