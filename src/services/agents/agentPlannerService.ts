/**
 * DevCouncil planner + repair orchestration.
 *
 * Rust runs `dev plan` / `dev repair` and parses export JSON; this service
 * materialises board tasks and assigns them across the agent team. Plans no
 * longer materialise straight away: the plan gate (Rework Plan §3.4 item 1)
 * parks each `dev plan` result in the pending-plan store below so the Inbox
 * can render an approval card, and only approval triggers materialisation.
 */

import type { AgentProfile, Task, TaskLink } from "../../../types";
import { STORAGE_KEYS } from "../../constants";
import storageService from "../storageService";
import { getBacklogColumnId } from "../../utils/taskUtils";
import { generateTaskId } from "../../utils/taskUtils";
import type { BoardColumn } from "../../../types";
import {
  isNativeBackend,
  nativeDevPlan,
  nativeDevRepair,
  type DevCouncilSubtask,
} from "../nativeBridge";
import agentScopeService from "./agentScopeService";

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

    agentScopeService.setScopeForTask(task.id, subtask.plannedFiles ?? []);
  }

  return { tasks, assignments };
}

// ---------------------------------------------------------------------------
// Pending-plan store (plan gate)
// ---------------------------------------------------------------------------

/** A `dev plan` result awaiting the user's approve/reject decision in the Inbox. */
export interface PendingPlan {
  id: string;
  /** Epic (parent) task the plan decomposes. */
  epicId: string;
  epicTitle: string;
  /** Planner agent that produced the plan. */
  agentId: string;
  agentName: string;
  goal: string;
  subtasks: DevCouncilSubtask[];
  requirementsCount: number;
  createdAt: Date;
  status: "pending" | "approved" | "rejected";
  /** Reviewer feedback recorded when the plan is rejected. */
  rejectionFeedback?: string;
}

type PendingPlanListener = (plans: PendingPlan[]) => void;

// Resolved plans are retained (capped) rather than deleted so a rejection's
// feedback stays on record for the session; only `pending` plans are surfaced.
const MAX_STORED_PLANS = 50;
let plans: PendingPlan[] = [];
const planListeners = new Set<PendingPlanListener>();

function revivePlan(raw: PendingPlan & { createdAt: string | Date }): PendingPlan {
  return {
    ...raw,
    createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt),
  };
}

function loadPlansFromStorage(): void {
  const stored = storageService.get<Array<PendingPlan & { createdAt: string }>>(
    STORAGE_KEYS.AGENT_PENDING_PLANS,
    [],
  );
  plans = (stored ?? []).map(revivePlan);
}

function persistPlans(): void {
  void storageService.set(
    STORAGE_KEYS.AGENT_PENDING_PLANS,
    plans.map((plan) => ({
      ...plan,
      createdAt: plan.createdAt.toISOString(),
    })),
  );
}

loadPlansFromStorage();

function notifyPlanListeners(): void {
  const snapshot = getPendingPlans();
  planListeners.forEach((l) => {
    l(snapshot);
  });
  persistPlans();
}

export function getPendingPlans(): PendingPlan[] {
  return plans.filter((p) => p.status === "pending");
}

/** Listener pattern mirrors agentMcpService.subscribePermissions: replay-on-subscribe. */
export function subscribePendingPlans(listener: PendingPlanListener): () => void {
  planListeners.add(listener);
  listener(getPendingPlans());
  return () => planListeners.delete(listener);
}

export function registerPendingPlan(
  input: Omit<PendingPlan, "id" | "createdAt" | "status" | "rejectionFeedback">,
): PendingPlan {
  const plan: PendingPlan = {
    ...input,
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    status: "pending",
  };
  plans = [plan, ...plans].slice(0, MAX_STORED_PLANS);
  notifyPlanListeners();
  return plan;
}

/**
 * Mark a pending plan approved and hand it back for materialisation. Returns
 * undefined when the plan was already resolved (double-click, stale card), so
 * callers can't materialise the same plan twice.
 */
export function approvePendingPlan(planId: string): PendingPlan | undefined {
  const plan = plans.find((p) => p.id === planId && p.status === "pending");
  if (!plan) return undefined;
  plan.status = "approved";
  notifyPlanListeners();
  return plan;
}

/** Discard a pending plan, keeping the reviewer's feedback on record. */
export function rejectPendingPlan(planId: string, feedback: string): PendingPlan | undefined {
  const plan = plans.find((p) => p.id === planId && p.status === "pending");
  if (!plan) return undefined;
  plan.status = "rejected";
  plan.rejectionFeedback = feedback.trim() || undefined;
  notifyPlanListeners();
  return plan;
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
  getPendingPlans,
  subscribePendingPlans,
  registerPendingPlan,
  approvePendingPlan,
  rejectPendingPlan,
};
