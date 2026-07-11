import { describe, expect, it } from "vitest";
import type { AgentRun, Project, Task } from "../../../types";
import {
  normalizePath,
  reconcileDiscoveredSessions,
  repoRoot,
  type DiscoveredSession,
} from "../sessionDiscoveryService";

const baseSession = (overrides: Partial<DiscoveredSession> = {}): DiscoveredSession => ({
  sessionId: "sess-1",
  runtime: "claude",
  projectPath: "/Users/dev/Code/LiquiTask",
  sessionPath: "/Users/dev/.claude/projects/x/sess-1.jsonl",
  modifiedAtMs: Date.now(),
  ...overrides,
});

describe("repoRoot", () => {
  it("strips claude worktree suffix", () => {
    expect(repoRoot("/Users/dev/Code/LiquiTask/.claude/worktrees/run-abc")).toBe(
      "/Users/dev/Code/LiquiTask",
    );
  });
});

describe("normalizePath", () => {
  it("normalizes trailing slashes and backslashes", () => {
    expect(normalizePath("/foo/bar/")).toBe("/foo/bar");
    expect(normalizePath("C:\\repo\\")).toBe("C:/repo");
  });
});

describe("reconcileDiscoveredSessions", () => {
  const task: Task = {
    id: "task-1",
    jobId: "TSK-1",
    projectId: "proj-1",
    title: "Existing",
    summary: "",
    assignee: "Agent",
    priority: "medium",
    status: "col-backlog",
    createdAt: new Date(),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
  };

  const projects: Project[] = [
    { id: "proj-1", name: "LiquiTask", type: "code", workspacePaths: ["/Users/dev/Code/LiquiTask"] },
  ];

  it("matches by sessionId first", () => {
    const runs: AgentRun[] = [
      {
        id: "run-1",
        taskId: task.id,
        agentId: "agent-1",
        status: "completed",
        createdAt: new Date(),
        events: [],
        sessionId: "sess-known",
        repoDir: "/Users/dev/Code/LiquiTask",
      },
    ];
    const discovered = [baseSession({ sessionId: "sess-known" })];
    const result = reconcileDiscoveredSessions(discovered, runs, [task], projects);
    expect(result.linked).toEqual([
      { sessionId: "sess-known", runId: "run-1", taskId: "task-1" },
    ]);
    expect(result.adoptable).toHaveLength(0);
  });

  it("matches by branch scoped to project path", () => {
    const runs: AgentRun[] = [
      {
        id: "run-2",
        taskId: task.id,
        agentId: "agent-1",
        status: "running",
        createdAt: new Date(),
        events: [],
        gitBranch: "feature/adopt",
        repoDir: "/Users/dev/Code/LiquiTask",
      },
    ];
    const discovered = [
      baseSession({
        sessionId: "sess-branch",
        gitBranch: "feature/adopt",
        projectPath: "/Users/dev/Code/LiquiTask",
      }),
    ];
    const result = reconcileDiscoveredSessions(discovered, runs, [task], projects);
    expect(result.linked[0]?.runId).toBe("run-2");
    expect(result.adoptable).toHaveLength(0);
  });

  it("surfaces unmatched sessions as adoptable", () => {
    const runs: AgentRun[] = [];
    const discovered = [
      baseSession({
        sessionId: "sess-orphan",
        preview: "Fix the flaky test",
        gitBranch: "feature/orphan",
      }),
    ];
    const result = reconcileDiscoveredSessions(discovered, runs, [task], projects);
    expect(result.linked).toHaveLength(0);
    expect(result.adoptable).toHaveLength(1);
    expect(result.adoptable[0]?.session.sessionId).toBe("sess-orphan");
  });

  it("respects dismissed session ids", () => {
    const discovered = [baseSession({ sessionId: "sess-dismissed" })];
    const result = reconcileDiscoveredSessions(
      discovered,
      [],
      [task],
      projects,
      new Set(["sess-dismissed"]),
    );
    expect(result.adoptable).toHaveLength(0);
  });
});
