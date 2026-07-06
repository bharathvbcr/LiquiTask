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
      ? `## Team knowledge (from previous runs in this repo)\n${skillsSection}`
      : "",
    `## Instructions`,
    [
      `- Work only inside the current repository.`,
      `- Follow the repository's CLAUDE.md conventions if present.`,
      `- Prefer minimal, well-tested changes; run the project's tests when available.`,
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
