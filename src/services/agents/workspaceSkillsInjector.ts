/**
 * Inject LiquiTask's skill knowledge into a workspace as real, on-disk skill
 * files under `<workspace>/.claude/skills/liquitask/`.
 *
 * Why files (not just prompt injection): LiquiTask already threads relevant
 * skills into its own agent prompts (see `skillSelection.ts`). But a repo handed
 * to *any* runtime — Claude Code, Codex, Cursor, … — only discovers skills that
 * live on disk in the conventional `<name>/SKILL.md` layout. Materializing the
 * team's compounded knowledge there makes it portable across every agent that
 * opens the repo, which is what "inject skills into the workspace" means.
 *
 * The plan (which files, what content) is a pure function so it can be unit
 * tested without a desktop backend; only `injectSkillsIntoWorkspace` touches the
 * filesystem, and it degrades to a no-op off-desktop or when there's nothing to
 * write.
 */
import { localApi } from "../../core/api/localApi";
import { mergeSkillCatalog, type SkillCatalogEntry } from "../../core/skills/mergeSkillCatalog";
import { getDesktopApi, isTauri } from "../../runtime/runtimeEnvironment";
import agentSkillsService from "./agentSkillsService";

/** Base folder (relative to the workspace) all injected skills live under. */
export const INJECTED_SKILLS_SUBDIR = ".claude/skills/liquitask";

/** Hard cap so a large library can't flood the repo; captured skills win. */
const MAX_INJECTED_SKILLS = 40;

export interface SkillFilePlan {
  /** Absolute path of the file to write. */
  path: string;
  /** Absolute path of the directory that must exist before writing `path`. */
  parentDir: string;
  /** File contents. */
  content: string;
}

export interface SkillInjectionPlan {
  /** Absolute base dir (`<workspace>/.claude/skills/liquitask`). */
  baseDir: string;
  /** Every file to write, INDEX first. */
  files: SkillFilePlan[];
}

export interface SkillInjectionResult {
  injected: number;
  baseDir: string | null;
  /** Set when nothing was written; a short machine-readable reason. */
  skipped?: "unavailable" | "empty" | "no-workspace";
}

/** Strip trailing slashes so path joins don't double up separators. */
function normalizeDir(dir: string): string {
  return dir.replace(/\/+$/, "");
}

/** URL/path-safe slug from a title, non-empty, deduped by the caller. */
export function slugifySkill(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "skill";
}

/**
 * Escape a value for a double-quoted YAML scalar: collapse to one line, trim,
 * truncate, and escape backslashes/quotes so a stray `:` or `"` in a summary
 * can't corrupt the frontmatter.
 */
export function toYamlScalar(value: string, maxLen = 200): string {
  const oneLine = value.replace(/\s+/g, " ").trim().slice(0, maxLen);
  const escaped = oneLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** First non-empty line of a summary, used as the frontmatter description. */
function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? "";
}

/** Render one skill's SKILL.md (frontmatter + body + provenance footer). */
export function renderSkillMarkdown(entry: SkillCatalogEntry): string {
  const description = firstLine(entry.summary) || entry.title;
  const origin =
    entry.origin === "captured"
      ? `captured from agent runs${entry.workingDir ? ` in ${entry.workingDir}` : ""}`
      : `installed skill${entry.provider ? ` (${entry.provider})` : ""}`;
  return [
    "---",
    `name: ${toYamlScalar(entry.title, 120)}`,
    `description: ${toYamlScalar(description)}`,
    "---",
    "",
    `# ${entry.title}`,
    "",
    entry.summary.trim() || "_No summary captured yet._",
    "",
    "---",
    `<!-- Injected by LiquiTask DevCouncil workspace sync — ${origin}.`,
    "     Regenerated on sync; edits here are overwritten. -->",
    "",
  ].join("\n");
}

/** Render the index that lists every injected skill. */
function renderIndex(entries: SkillCatalogEntry[], slugs: string[]): string {
  const rows = entries
    .map((entry, i) => `- [${entry.title}](./${slugs[i]}/SKILL.md) — ${firstLine(entry.summary) || "—"}`)
    .join("\n");
  return [
    "# LiquiTask Injected Skills",
    "",
    "Compounded team knowledge and installed skill packs, materialized here so any",
    "coding agent that opens this repo can discover them. Managed by LiquiTask —",
    "this folder is regenerated on workspace sync.",
    "",
    rows || "_No skills yet._",
    "",
  ].join("\n");
}

/**
 * Rank + cap the catalog for injection: captured (repo-specific) skills first,
 * then installed, preserving input order within each group.
 */
function selectForInjection(catalog: SkillCatalogEntry[]): SkillCatalogEntry[] {
  const captured = catalog.filter((e) => e.origin === "captured");
  const installed = catalog.filter((e) => e.origin === "installed");
  return [...captured, ...installed].slice(0, MAX_INJECTED_SKILLS);
}

/**
 * Pure plan: given a merged catalog and workspace dir, compute exactly which
 * files to write and their contents. Slugs are deduped so two same-titled
 * skills don't clobber each other.
 */
export function planSkillInjection(
  catalog: SkillCatalogEntry[],
  workingDir: string,
): SkillInjectionPlan {
  const baseDir = `${normalizeDir(workingDir)}/${INJECTED_SKILLS_SUBDIR}`;
  const entries = selectForInjection(catalog);

  const usedSlugs = new Set<string>();
  const slugs = entries.map((entry) => {
    const base = slugifySkill(entry.title);
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    return slug;
  });

  const files: SkillFilePlan[] = [
    { path: `${baseDir}/INDEX.md`, parentDir: baseDir, content: renderIndex(entries, slugs) },
  ];
  entries.forEach((entry, i) => {
    const dir = `${baseDir}/${slugs[i]}`;
    files.push({ path: `${dir}/SKILL.md`, parentDir: dir, content: renderSkillMarkdown(entry) });
  });

  return { baseDir, files };
}

/** Build the merged, injectable catalog for a repo (captured + installed). */
export async function buildInjectionCatalog(workingDir: string): Promise<SkillCatalogEntry[]> {
  const captured = agentSkillsService.getSkillsForWorkingDir(workingDir);
  let installed: Awaited<ReturnType<typeof localApi.listSkills>>;
  try {
    installed = await localApi.listSkills();
  } catch {
    installed = undefined;
  }
  return mergeSkillCatalog(captured, installed);
}

/**
 * Materialize the repo's skills to disk. No-ops (with a reason) off-desktop,
 * without a workspace, or when there's nothing to write. Per-file failures are
 * swallowed so one unwritable path can't abort the whole sync.
 */
export async function injectSkillsIntoWorkspace(
  workingDir: string,
): Promise<SkillInjectionResult> {
  if (!workingDir) return { injected: 0, baseDir: null, skipped: "no-workspace" };
  const api = getDesktopApi();
  if (!isTauri() || !api) return { injected: 0, baseDir: null, skipped: "unavailable" };

  const catalog = await buildInjectionCatalog(workingDir);
  if (catalog.length === 0) return { injected: 0, baseDir: null, skipped: "empty" };

  const plan = planSkillInjection(catalog, workingDir);
  const scope = [workingDir];
  let injected = 0;
  const ensured = new Set<string>();

  for (const file of plan.files) {
    try {
      if (!ensured.has(file.parentDir)) {
        await api.workspace.ensureDir(file.parentDir, scope);
        ensured.add(file.parentDir);
      }
      await api.workspace.writeFile(file.path, file.content, scope);
      injected += 1;
    } catch (err) {
      console.warn(`[skills-inject] failed to write ${file.path}:`, err);
    }
  }

  return { injected, baseDir: plan.baseDir };
}
