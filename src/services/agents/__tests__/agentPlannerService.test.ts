import { describe, expect, it, vi } from "vitest";

import agentPlannerService, {
  approvePendingPlan,
  assignSubtasksToAgents,
  getPendingPlans,
  materializeSubtasks,
  registerPendingPlan,
  rejectPendingPlan,
  subscribePendingPlans,
} from "../agentPlannerService";
import type { AgentProfile, BoardColumn, Task } from "../../../../types";

const columns: BoardColumn[] = [
  { id: "col-backlog", title: "Backlog", order: 0, isCompleted: false },
];

const epic: Task = {
  id: "epic-1",
  jobId: "TSK-100",
  projectId: "proj-1",
  title: "Build auth",
  summary: "OAuth + sessions",
  assignee: "",
  priority: "high",
  status: "col-backlog",
  createdAt: new Date(),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 0,
  timeSpent: 0,
};

const agents: AgentProfile[] = [
  {
    id: "planner-1",
    name: "Planner",
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: false,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    role: "planner",
    createdAt: new Date(),
  },
  {
    id: "worker-a",
    name: "Alice",
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: true,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    role: "default",
    createdAt: new Date(),
  },
  {
    id: "worker-b",
    name: "Bob",
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: false,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    role: "default",
    createdAt: new Date(),
  },
];

describe("agentPlannerService", () => {
  it("round-robins subtasks across workers in the same repo", () => {
    const subtasks = [
      { id: "T1", title: "A", description: "", dependsOn: [] },
      { id: "T2", title: "B", description: "", dependsOn: [] },
      { id: "T3", title: "C", description: "", dependsOn: [] },
    ];
    const paired = assignSubtasksToAgents(subtasks, agents, "/repo");
    expect(paired.map((p) => p.agent?.name)).toEqual(["Alice", "Bob", "Alice"]);
    expect(paired.every((p) => p.agent?.role !== "planner")).toBe(true);
  });

  it("materializes linked board tasks from DevCouncil export", () => {
    const { tasks, assignments } = materializeSubtasks({
      parentTask: epic,
      subtasks: [
        {
          id: "TASK-001",
          title: "Implement API",
          description: "REST layer",
          priority: "high",
          dependsOn: [],
        },
      ],
      agents,
      columns,
      tagPrefix: "plan:epic-1",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].links?.[0]).toEqual({ targetTaskId: "epic-1", type: "relates-to" });
    expect(tasks[0].tags).toContain("plan:epic-1");
    expect(assignments[0].agentName).toBe("Alice");
  });

  it("repairFromGaps synthesizes tasks without native backend", async () => {
    const result = await agentPlannerService.repairFromGaps("/repo", [
      "Missing unit test for login",
    ]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].sourceGap).toContain("Missing unit test");
  });
});

// The store is a module-level singleton, so tests find their own plan by id
// instead of asserting on absolute pending counts.
describe("pending-plan store", () => {
  const planInput = () => ({
    epicId: "epic-1",
    epicTitle: "Build auth",
    agentId: "planner-1",
    agentName: "Planner",
    goal: "Build auth — OAuth + sessions",
    subtasks: [{ id: "T1", title: "A", description: "", dependsOn: [] }],
    requirementsCount: 3,
  });

  it("registers a plan as pending and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingPlans(listener);
    // Replay-on-subscribe (agentMcpService pattern).
    expect(listener).toHaveBeenCalledTimes(1);

    const plan = registerPendingPlan(planInput());
    expect(plan.status).toBe("pending");
    expect(getPendingPlans().some((p) => p.id === plan.id)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.lastCall?.[0].some((p: { id: string }) => p.id === plan.id)).toBe(true);

    unsubscribe();
    approvePendingPlan(plan.id);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("approvePendingPlan resolves the plan out of the pending feed exactly once", () => {
    const plan = registerPendingPlan(planInput());
    const approved = approvePendingPlan(plan.id);
    expect(approved?.status).toBe("approved");
    expect(getPendingPlans().some((p) => p.id === plan.id)).toBe(false);
    // Second resolution (double-click / stale card) is a no-op.
    expect(approvePendingPlan(plan.id)).toBeUndefined();
  });

  it("rejectPendingPlan discards the plan but keeps the feedback on record", () => {
    const plan = registerPendingPlan(planInput());
    const rejected = rejectPendingPlan(plan.id, "Too many subtasks — split differently.");
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.rejectionFeedback).toBe("Too many subtasks — split differently.");
    expect(getPendingPlans().some((p) => p.id === plan.id)).toBe(false);
    expect(rejectPendingPlan(plan.id, "again")).toBeUndefined();
  });
});
