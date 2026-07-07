import { describe, expect, it } from "vitest";
import { deriveAutopilots, describeCadence } from "../deriveAutopilots";
import type { AgentProfile, AgentRun, RecurringConfig, Task } from "../../../../types";

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-1",
    name: "Codey",
    provider: "claude-code",
    workingDir: "/repo/app",
    permissionMode: "default",
    sandbox: "host",
    autoPickup: true,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  } as AgentProfile;
}

function makeRecurring(overrides: Partial<RecurringConfig> = {}): RecurringConfig {
  return {
    enabled: true,
    frequency: "daily",
    interval: 1,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    jobId: "TSK-1",
    projectId: "p1",
    title: "Nightly triage",
    summary: "",
    assignee: "Codey",
    priority: "medium",
    status: "Pending",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    recurring: makeRecurring(),
    ...overrides,
  } as Task;
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    taskId: "task-x",
    agentId: "agent-1",
    status: "completed",
    createdAt: new Date("2026-07-05T00:00:00Z"),
    events: [],
    ...overrides,
  } as AgentRun;
}

describe("describeCadence", () => {
  it("labels daily cadences", () => {
    expect(describeCadence(makeRecurring({ frequency: "daily", interval: 1 }))).toBe("Daily");
    expect(describeCadence(makeRecurring({ frequency: "daily", interval: 3 }))).toBe("Every 3 days");
  });

  it("labels weekly cadences with sorted day names", () => {
    expect(describeCadence(makeRecurring({ frequency: "weekly", interval: 1 }))).toBe("Weekly");
    expect(
      describeCadence(makeRecurring({ frequency: "weekly", interval: 2, daysOfWeek: [5, 1] })),
    ).toBe("Every 2 weeks on Mon, Fri");
  });

  it("labels monthly cadences with the day of month", () => {
    expect(describeCadence(makeRecurring({ frequency: "monthly", interval: 1 }))).toBe("Monthly");
    expect(
      describeCadence(makeRecurring({ frequency: "monthly", interval: 1, dayOfMonth: 15 })),
    ).toBe("Monthly on day 15");
  });

  it("treats custom intervals as days", () => {
    expect(describeCadence(makeRecurring({ frequency: "custom", interval: 10 }))).toBe(
      "Every 10 days",
    );
  });
});

describe("deriveAutopilots", () => {
  it("returns empty for empty inputs", () => {
    expect(deriveAutopilots([], [], [])).toEqual([]);
  });

  it("pairs an enabled recurring task with its runsOnRecurrence agent", () => {
    const agent = makeAgent();
    const next = new Date("2026-07-07T09:00:00Z");
    const task = makeTask({ recurring: makeRecurring({ nextOccurrence: next }) });

    const [autopilot] = deriveAutopilots([agent], [task], []);
    expect(autopilot).toMatchObject({
      id: "autopilot:agent-1:task-1",
      agentId: "agent-1",
      agentName: "Codey",
      taskId: "task-1",
      taskTitle: "Nightly triage",
      cadenceLabel: "Daily",
      healthy: true,
    });
    expect(autopilot.nextRunAt?.getTime()).toBe(next.getTime());
    expect(autopilot.lastRun).toBeUndefined();
  });

  it("matches assignee to agent name case-insensitively", () => {
    const agent = makeAgent({ name: "Codey" });
    const task = makeTask({ assignee: "  codey " });
    expect(deriveAutopilots([agent], [task], [])).toHaveLength(1);
  });

  it("skips disabled recurring configs, human assignees, and opted-out agents", () => {
    const agent = makeAgent();
    const optedOut = makeAgent({ id: "agent-2", name: "Sleepy", runsOnRecurrence: false });
    const tasks = [
      makeTask({ id: "t1", recurring: makeRecurring({ enabled: false }) }),
      makeTask({ id: "t2", assignee: "A Human" }),
      makeTask({ id: "t3", assignee: "Sleepy" }),
      makeTask({ id: "t4" }), // the only live automation
    ];
    const autopilots = deriveAutopilots([agent, optedOut], tasks, []);
    expect(autopilots).toHaveLength(1);
    expect(autopilots[0].taskId).toBe("t4");
  });

  it("reports the agent's latest run and marks failed runs unhealthy", () => {
    const agent = makeAgent();
    const task = makeTask();
    const runs = [
      makeRun({ id: "r-old", status: "completed", finishedAt: new Date("2026-07-01T00:00:00Z") }),
      makeRun({
        id: "r-new",
        status: "failed",
        finishedAt: new Date("2026-07-05T00:00:00Z"),
        error: "boom",
      }),
    ];

    const [autopilot] = deriveAutopilots([agent], [task], runs);
    expect(autopilot.lastRun).toEqual({
      status: "failed",
      finishedAt: new Date("2026-07-05T00:00:00Z"),
    });
    expect(autopilot.healthy).toBe(false);
  });

  it("marks a blocked (paused) latest run unhealthy", () => {
    const agent = makeAgent();
    const task = makeTask();
    const runs = [
      makeRun({ id: "r1", status: "running", isPaused: true, startedAt: new Date("2026-07-06T00:00:00Z") }),
    ];
    const [autopilot] = deriveAutopilots([agent], [task], runs);
    expect(autopilot.healthy).toBe(false);
  });

  it("sorts by agent name then task title", () => {
    const agents = [makeAgent({ id: "a1", name: "Zed" }), makeAgent({ id: "a2", name: "Amp" })];
    const tasks = [
      makeTask({ id: "t1", assignee: "Zed", title: "B job" }),
      makeTask({ id: "t2", assignee: "Amp", title: "Z job" }),
      makeTask({ id: "t3", assignee: "Zed", title: "A job" }),
    ];
    const order = deriveAutopilots(agents, tasks, []).map((a) => `${a.agentName}/${a.taskTitle}`);
    expect(order).toEqual(["Amp/Z job", "Zed/A job", "Zed/B job"]);
  });
});
