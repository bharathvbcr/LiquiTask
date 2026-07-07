/**
 * Resolve which directory an agent run should execute in.
 *
 * The bug this fixes: `AgentProfile.workingDir` is a single fixed folder with no
 * link to the task's project, so a task from project A handed to an agent whose
 * folder points at project B would run against B's repository. Runs must instead
 * execute in the *task's project* workspace.
 *
 * Policy (chosen by the product owner): prefer the project's workspace; if the
 * project has no workspace folder linked at all, BLOCK rather than silently fall
 * back to the agent's (possibly wrong) folder.
 */
import type { AgentProfile, Project, Task } from "../../../types";

export type WorkspaceResolution =
  | {
      ok: true;
      /** Directory the run should execute in. */
      workingDir: string;
      /** True when this differs from the agent's configured `workingDir`. */
      overrodeAgentDir: boolean;
      projectName?: string;
    }
  | { ok: false; reason: string };

/**
 * @param task     the task being run (provides `projectId`)
 * @param agent    the agent handling it (provides its configured `workingDir`)
 * @param projects all known projects (provides each project's `workspacePaths`)
 */
export function resolveAgentWorkspace(
  task: Task,
  agent: AgentProfile,
  projects: Project[],
): WorkspaceResolution {
  const project = projects.find((p) => p.id === task.projectId);
  const paths = (project?.workspacePaths ?? []).map((p) => p.trim()).filter(Boolean);

  if (paths.length === 0) {
    return {
      ok: false,
      reason: project
        ? `Project "${project.name}" has no workspace folder linked. Link one in the project's settings before running an agent, so work doesn't land in the wrong repository.`
        : "This task isn't linked to a project workspace, so there's no folder to run in. Move it into a project that has a workspace folder linked.",
    };
  }

  const agentDir = agent.workingDir?.trim();
  // Agent is already pointed at one of the project's folders — keep it.
  if (agentDir && paths.includes(agentDir)) {
    return {
      ok: true,
      workingDir: agentDir,
      overrodeAgentDir: false,
      projectName: project?.name,
    };
  }

  // Otherwise run in the project's canonical (first-linked) folder.
  return {
    ok: true,
    workingDir: paths[0],
    overrodeAgentDir: true,
    projectName: project?.name,
  };
}
