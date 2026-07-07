import type { AgentSkill, Subtask, Task } from "../../../types";

const MAX_SKILLS_IN_PROMPT = 5;
const MAX_SKILL_SUMMARY_CHARS = 600;

/**
 * Build the briefing handed to Claude Code for a task (Multica-style):
 * the task itself, open subtasks, and compounded team skills from previous
 * successful runs in the same repository.
 */
export const buildTaskPrompt = (task: Task, skills: AgentSkill[] = []): string => {
  const subtasks = (task.subtasks ?? [])
    .filter((s: Subtask) => !s.completed)
    .map((s: Subtask) => `- ${s.title}`)
    .join("\n");

  const skillsSection = skills
    .slice(0, MAX_SKILLS_IN_PROMPT)
    .map(
      (skill) =>
        `### ${skill.title}\n${skill.summary.slice(0, MAX_SKILL_SUMMARY_CHARS)}`,
    )
    .join("\n\n");

  const sections = [
    `You are working as an autonomous teammate on the following task from the LiquiTask board.`,
    `## Task ${task.jobId || task.id}: ${task.title}`,
    task.subtitle ? `Subtitle: ${task.subtitle}` : "",
    task.summary ? `## Description\n${task.summary}` : "",
    subtasks ? `## Open subtasks\n${subtasks}` : "",
    task.tags?.length ? `Tags: ${task.tags.join(", ")}` : "",
    skillsSection
      ? `## Team knowledge & skills (prior runs in this repo + installed skill packs)\n${skillsSection}`
      : "",
    `## Board workflow (liquitask MCP tools)`,
    [
      `Your task card lives on a kanban board with columns: Task → In Progress → Completed → Commit.`,
      `- Your card is already in **In Progress**; you are likely working in an isolated git worktree on your own branch.`,
      `- Use \`post_comment\` to report progress at each major step — the user follows your work live on the board.`,
      `- Use \`toggle_subtask\` to check off subtasks as you finish them, and \`create_subtask\`/\`report_blocker\` when you discover new work or blockers.`,
      `- Use \`get_worktree_state\` to inspect your isolated worktree (branch, dirty files, commits ahead) — check it before claiming completion.`,
      `- When your work is done and verified, call \`complete_task\` with a summary — this moves the card to **Completed**. Completion is verified: an empty worktree is rejected unless you pass \`no_changes: true\` with a justification.`,
      `- Do NOT try to move the card to **Commit**: that stage is human-gated (a person reviews your diff and the transactional merge pipeline commits/merges the worktree).`,
    ].join("\n"),
    `## Instructions`,
    [
      `- Work only inside the current repository.`,
      `- Follow the repository's CLAUDE.md conventions if present.`,
      `- Prefer minimal, well-tested changes; run the project's tests when available.`,
      `- Do not run \`git commit\`, switch branches, or push unless the task explicitly asks — committing/merging happens from the board's Commit stage.`,
      `- Before large refactors or when stuck, call the \`get_user_guidance\` MCP tool — the user may inject mid-run course corrections from the board.`,
      `- Finish with a concise summary of what changed, files touched, and anything left open.`,
    ].join("\n"),
  ];
  return sections.filter(Boolean).join("\n\n");
};

/** Council mode passes a goal, not a briefing — DevCouncil does its own planning. */
export const buildCouncilGoal = (task: Task): string => {
  const parts = [task.title, task.summary].filter(Boolean);
  return parts.join(" — ").slice(0, 2000);
};

/**
 * Append DevCouncil's repo-map orientation to a built prompt. Works for both
 * the TS and native (Rust) prompt builders so repo context is engine-agnostic.
 */
export const withRepoContext = (prompt: string, repoContext?: string | null): string => {
  const trimmed = repoContext?.trim();
  if (!trimmed) return prompt;
  return [
    prompt,
    `## Repository map (DevCouncil)`,
    `${trimmed}\n\nUse \`.devcouncil/repo_map.json\` for the full index; prefer these entry points over blind searching.`,
  ].join("\n\n");
};

/** How many real files to inline before truncating (keeps the prompt bounded). */
export const MAX_REPO_FILES_IN_PROMPT = 150;

/**
 * Append a compact index of the repo's ACTUAL tracked files so a default
 * (non-council) run edits/opens real paths instead of guessing or blind
 * searching. No-ops when the file list is empty (repo not DevCouncil-mapped).
 */
export const withRepoFileIndex = (prompt: string, files?: string[] | null): string => {
  if (!files || files.length === 0) return prompt;
  const shown = files.slice(0, MAX_REPO_FILES_IN_PROMPT);
  const list = shown.map((f) => `- ${f}`).join("\n");
  const suffix =
    files.length > shown.length ? `\n…and ${files.length - shown.length} more file(s).` : "";
  return [
    prompt,
    `## Repository files (real index)`,
    `These are actual tracked files in this repo — prefer these exact paths over guessing or blind searching:\n\n${list}${suffix}`,
  ].join("\n\n");
};
