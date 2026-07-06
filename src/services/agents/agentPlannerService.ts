/**
 * DevCouncil planner + repair orchestration.
 *
 * Rust runs `dev plan` / `dev repair` and parses export JSON; this service
 * materialises board tasks and assigns them across the agent team.
 */

import type { AgentProfile, Task, TaskLink } from "../../../types";
import { getBacklogColumnId } from "../../utils/taskUtils";
import { generateTaskId } from "../../utils/taskUtils";
import type { BoardColumn } from "../../../types";
import {
  isNativeBackend,
  nativeDevPlan,
  nativeDevRepair,
  type DevCouncilSubtask,
} from "../nativeBridge";

export interface PlannerMaterializeOptions {
  parentTask: Task;
  subtasks: DevCouncilSubtask[];
  agents: AgentProfile[];
  columns: BoardColumn[];
  /** Link new tasks back to the parent epic. */
  linkType?: TaskLink["type"];
  /** Tag prefix for idempotency (e.g. repair run id). */
  tagPrefix?: string;
}

export interface MaterializedPlan {
  tasks: Task[];
  assignments: Array<{ taskId: string; agentName: string }>;
}

const workersForRepo = (agents: AgentProfile[], workingDir: string): AgentProfile[] =>
  agents.filter(
    (a) => (a.role ?? "default") !== "planner" && a.workingDir === workingDir,
  );

/** Round-robin assign subtasks across non-planner agents in the same repo. */
export function assignSubtasksToAgents(
  subtasks: DevCouncilSubtask[],
  agents: AgentProfile[],
  workingDir: string,
): Array<{ subtask: DevCouncilSubtask; agent: AgentProfile | undefined }> {
  const workers = workersForRepo(agents, workingDir);
  return subtasks.map((subtask, index) => ({
    subtask,
    agent: workers.length > 0 ? workers[index % workers.length] : undefined,
  }));
}

export function buildLinkedTask(
  partial: {
    title: string;
    summary: string;
    projectId: string;
    assignee?: string;
    priority?: string;
    tags?: string[];
    links?: TaskLink[];
  },
  columns: BoardColumn[],
): Task {
  return {
    id: generateTaskId(),
    jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
    projectId: partial.projectId,
    title: partial.title,
    summary: partial.summary,
    assignee: partial.assignee ?? "",
    priority: partial.priority ?? "medium",
    status: getBacklogColumnId(columns),
    createdAt: new Date(),
    subtasks: [],
    attachments: [],
    tags: partial.tags ?? [],
    links: partial.links,
    timeEstimate: 0,
    timeSpent: 0,
  };
}

/** Turn DevCouncil subtasks into board tasks linked to a parent epic. */
export function materializeSubtasks(options: PlannerMaterializeOptions): MaterializedPlan {
  const {
    parentTask,
    subtasks,
    agents,
    columns,
    linkType = "relates-to",
    tagPrefix,
  } = options;

  const workingDir =
    agents.find((a) => a.workingDir)?.workingDir ??
    agents.find((a) => a.id === parentTask.assignee)?.workingDir ??
    "";

  const paired = assignSubtasksToAgents(subtasks, agents, workingDir);
  const tasks: Task[] = [];
  const assignments: MaterializedPlan["assignments"] = [];

  for (const { subtask, agent } of paired) {
    const tags = [`epic:${parentTask.id}`, `devcouncil:${subtask.id}`];
    if (tagPrefix) tags.push(tagPrefix);

    const task = buildLinkedTask(
      {
        title: subtask.title,
        summary: subtask.description || subtask.title,
        projectId: parentTask.projectId,
        assignee: agent?.name ?? "",
        priority: subtask.priority ?? parentTask.priority,
        tags,
        links: [{ targetTaskId: parentTask.id, type: linkType }],
      },
      columns,
    );
    tasks.push(task);
    if (agent) assignments.push({ taskId: task.id, agentName: agent.name });
  }

  return { tasks, assignments };
}

function epicGoalFromTask(task: Task): string {
  const parts = [task.title];
  if (task.summary?.trim()) parts.push(task.summary.trim());
  if (task.subtitle?.trim()) parts.unshift(task.subtitle.trim());
  return parts.join(" — ").slice(0, 4000);
}

/** Run DevCouncil plan for an epic and return structured subtasks. */
export async function planEpic(
  epic: Task,
  agent: AgentProfile,
): Promise<{ result: Awaited<ReturnType<typeof nativeDevPlan>>; goal: string }> {
  const goal = epicGoalFromTask(epic);
  if (!isNativeBackend()) {
    return {
      goal,
      result: {
        success: false,
        cliAvailable: false,
        tasks: [],
        requirementsCount: 0,
        error: "Planner requires the Tauri desktop app.",
      },
    };
  }
  const result = await nativeDevPlan(agent.workingDir, goal);
  return { result, goal };
}

/** Run DevCouncil repair (or gap fallback) for blocking gate failures. */
export async function repairFromGaps(
  workingDir: string,
  gaps: string[],
): Promise<Awaited<ReturnType<typeof nativeDevRepair>>> {
  if (!isNativeBackend()) {
    return {
      success: gaps.length > 0,
      cliAvailable: false,
      tasks: gaps.map((gap, i) => ({
        id: `GAP-${String(i + 1).padStart(3, "0")}`,
        title: gap.slice(0, 120),
        description: gap,
        priority: "high",
        dependsOn: [],
        sourceGap: gap,
      })),
      error: gaps.length === 0 ? "No gaps to repair." : undefined,
    };
  }
  return nativeDevRepair(workingDir, gaps);
}

export default {
  planEpic,
  repairFromGaps,
  materializeSubtasks,
  assignSubtasksToAgents,
  buildLinkedTask,
};
