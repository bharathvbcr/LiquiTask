import { describe, expect, it } from "vitest";

import type { AgentSkill, Task } from "../../../../types";
import { buildCouncilGoal, buildTaskPrompt } from "../agentPrompt";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  jobId: "JOB-42",
  projectId: "proj-1",
  title: "Fix login redirect loop",
  summary: "Users bounce between /login and /home when the session cookie is stale.",
  assignee: "Claude",
  priority: "high",
  status: "Pending",
  createdAt: new Date("2026-01-01"),
  subtasks: [
    { id: "s1", title: "Reproduce with stale cookie", completed: true },
    { id: "s2", title: "Add regression test", completed: false },
  ],
  attachments: [],
  tags: ["auth", "bug"],
  timeEstimate: 0,
  timeSpent: 0,
  ...overrides,
});

const makeSkill = (overrides: Partial<AgentSkill> = {}): AgentSkill => ({
  id: "skill-1",
  title: "Fix session refresh",
  summary: "Refreshed tokens in authService; tests live in src/auth/__tests__.",
  workingDir: "/repo",
  taskId: "task-0",
  agentId: "agent-1",
  createdAt: new Date("2026-01-01"),
  ...overrides,
});

describe("buildTaskPrompt", () => {
  it("includes the task id, title, description and tags", () => {
    const prompt = buildTaskPrompt(makeTask());
    expect(prompt).toContain("JOB-42");
    expect(prompt).toContain("Fix login redirect loop");
    expect(prompt).toContain("session cookie is stale");
    expect(prompt).toContain("auth, bug");
  });

  it("lists only open subtasks", () => {
    const prompt = buildTaskPrompt(makeTask());
    expect(prompt).toContain("Add regression test");
    expect(prompt).not.toContain("Reproduce with stale cookie");
  });

  it("injects compounded team skills when provided", () => {
    const prompt = buildTaskPrompt(makeTask(), [makeSkill()]);
    expect(prompt).toContain("Team knowledge");
    expect(prompt).toContain("Fix session refresh");
  });

  it("omits the team knowledge section without skills", () => {
    expect(buildTaskPrompt(makeTask())).not.toContain("Team knowledge");
  });

  it("caps the number of injected skills at five", () => {
    const skills = Array.from({ length: 8 }, (_, i) =>
      makeSkill({ id: `skill-${i}`, title: `Skill number ${i}` }),
    );
    const prompt = buildTaskPrompt(makeTask(), skills);
    expect(prompt).toContain("Skill number 4");
    expect(prompt).not.toContain("Skill number 5");
  });
});

describe("buildCouncilGoal", () => {
  it("joins title and summary into a single goal", () => {
    const goal = buildCouncilGoal(makeTask());
    expect(goal).toContain("Fix login redirect loop");
    expect(goal).toContain("session cookie");
  });

  it("bounds the goal length", () => {
    const goal = buildCouncilGoal(makeTask({ summary: "x".repeat(5000) }));
    expect(goal.length).toBeLessThanOrEqual(2000);
  });
});
