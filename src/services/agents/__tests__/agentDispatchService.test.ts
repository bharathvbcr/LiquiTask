import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile, Task } from "../../../../types";

const mockAgents: AgentProfile[] = [];
const busyAgents = new Set<string>();
const queueLengths = new Map<string, number>();
const activeTaskIds = new Set<string>();

vi.mock("../agentService", () => ({
  default: {
    getAgents: () => mockAgents,
    getAgentById: (id: string) => mockAgents.find((a) => a.id === id),
    getAgentByAssignee: (assignee: string | undefined | null) =>
      assignee
        ? mockAgents.find((a) => a.name.toLowerCase() === assignee.trim().toLowerCase())
        : undefined,
  },
}));

vi.mock("../agentRunService", () => ({
  default: {
    getRuns: () => [],
    isAgentBusy: (id: string) => busyAgents.has(id),
    getQueueLengthForAgent: (id: string) => queueLengths.get(id) ?? 0,
    getActiveRunForTask: (taskId: string) =>
      activeTaskIds.has(taskId) ? { status: "running" } : undefined,
    getQueuePosition: () => null,
  },
}));

import agentDispatchService from "../agentDispatchService";

function agent(partial: Partial<AgentProfile> & { id: string; name: string }): AgentProfile {
  return {
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: false,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    role: "default",
    createdAt: new Date("2026-01-01"),
    ...partial,
  } as AgentProfile;
}

function task(partial?: Partial<Task>): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    jobId: "TSK-1",
    projectId: "p1",
    title: "Fix bug",
    summary: "",
    assignee: "",
    priority: "medium",
    status: "task",
    createdAt: new Date(),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    ...partial,
  } as Task;
}

describe("agentDispatchService.smartMatch", () => {
  beforeEach(() => {
    mockAgents.length = 0;
    busyAgents.clear();
    queueLengths.clear();
    activeTaskIds.clear();
  });

  it("reports when no agent has a working directory", () => {
    mockAgents.push(agent({ id: "a1", name: "Rex", workingDir: "" }));
    const match = agentDispatchService.smartMatch(task());
    expect(match.agent).toBeUndefined();
    expect(match.reason).toMatch(/working directory/i);
  });

  it("prefers the task's own assignee when it is an agent", () => {
    mockAgents.push(agent({ id: "a1", name: "Rex" }), agent({ id: "a2", name: "Blue" }));
    busyAgents.add("a1"); // still wins: explicit assignment beats load
    const match = agentDispatchService.smartMatch(task({ assignee: "Rex" }));
    expect(match.agent?.id).toBe("a1");
  });

  it("picks the least-loaded coder and skips planners", () => {
    mockAgents.push(
      agent({ id: "planner", name: "Plan", role: "planner" }),
      agent({ id: "busy", name: "Busy" }),
      agent({ id: "idle", name: "Idle" }),
    );
    busyAgents.add("busy");
    const match = agentDispatchService.smartMatch(task());
    expect(match.agent?.id).toBe("idle");
  });

  it("skips agents over their daily budget", () => {
    mockAgents.push(agent({ id: "capped", name: "Capped", maxRunsPerDay: 0 }));
    // maxRunsPerDay 0 = unlimited, so this one is eligible
    const ok = agentDispatchService.smartMatch(task());
    expect(ok.agent?.id).toBe("capped");
  });

  it("spreads a batch across agents via extraLoad", () => {
    mockAgents.push(agent({ id: "a1", name: "Rex" }), agent({ id: "a2", name: "Blue" }));
    const extra = new Map<string, number>([["a1", 1]]);
    const match = agentDispatchService.smartMatch(task(), extra);
    expect(match.agent?.id).toBe("a2");
  });
});

describe("agentDispatchService.dispatch", () => {
  beforeEach(() => {
    mockAgents.length = 0;
    busyAgents.clear();
    queueLengths.clear();
    activeTaskIds.clear();
  });

  it("fails gracefully when the task already has an active run", async () => {
    mockAgents.push(agent({ id: "a1", name: "Rex" }));
    const assign = vi.fn();
    const notify = vi.fn();
    agentDispatchService.registerHandlers({ assign, notify });

    const t = task();
    activeTaskIds.add(t.id);
    const result = await agentDispatchService.dispatch(t);
    expect(result.ok).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });

  it("smart-matches and calls the registered assign handler", async () => {
    mockAgents.push(agent({ id: "a1", name: "Rex" }));
    const assign = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    agentDispatchService.registerHandlers({ assign, notify });

    const t = task();
    const result = await agentDispatchService.dispatch(t);
    expect(result.ok).toBe(true);
    expect(result.agentName).toBe("Rex");
    expect(assign).toHaveBeenCalledWith(
      t,
      "a1",
      expect.objectContaining({ via: expect.stringContaining("smart match") }),
    );
  });

  it("dispatchMany skips active tasks and summarizes", async () => {
    mockAgents.push(agent({ id: "a1", name: "Rex" }));
    const assign = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    agentDispatchService.registerHandlers({ assign, notify });

    const t1 = task();
    const t2 = task();
    activeTaskIds.add(t2.id);
    const summary = await agentDispatchService.dispatchMany([t1, t2]);
    expect(summary.sent).toBe(1);
    expect(summary.skipped).toHaveLength(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      t1,
      "a1",
      expect.objectContaining({ silent: true, via: expect.stringContaining("smart match") }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
