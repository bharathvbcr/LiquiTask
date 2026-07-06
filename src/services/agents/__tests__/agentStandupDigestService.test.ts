import { describe, expect, it } from "vitest";

import type { AgentProfile, AgentRun, Task } from "../../../../types";
import {
  buildAgentStandupDigest,
  defaultStandupSince,
  formatStandupDigestText,
} from "../agentStandupDigestService";

const agent: AgentProfile = {
  id: "a1",
  name: "Claude",
  provider: "claude-code",
  workingDir: "/repo",
  permissionMode: "default",
  sandbox: "host",
  autoPickup: false,
  runsOnRecurrence: true,
  devCouncilVerify: false,
  createdAt: new Date(),
};

const task: Task = {
  id: "t1",
  jobId: "J1",
  projectId: "p1",
  title: "Ship feature",
  summary: "",
  assignee: "Claude",
  priority: "medium",
  status: "InProgress",
  createdAt: new Date(),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 60,
  timeSpent: 0,
};

describe("agentStandupDigestService", () => {
  it("defaultStandupSince picks the more recent of 12h ago vs yesterday 6am", () => {
    const now = new Date("2026-07-05T08:00:00");
    const since = defaultStandupSince(12, now);
    expect(since.getTime()).toBeGreaterThan(new Date("2026-07-04T06:00:00").getTime());
    expect(since.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("aggregates completed, failed, cost, and permissions", () => {
    const since = new Date("2026-07-05T00:00:00");
    const runs: AgentRun[] = [
      {
        id: "r1",
        taskId: "t1",
        agentId: "a1",
        status: "completed",
        createdAt: since,
        startedAt: since,
        finishedAt: new Date("2026-07-05T01:00:00"),
        costUsd: 1.25,
        events: [],
      },
      {
        id: "r2",
        taskId: "t1",
        agentId: "a1",
        status: "failed",
        createdAt: since,
        startedAt: since,
        finishedAt: new Date("2026-07-05T02:00:00"),
        costUsd: 0.5,
        error: "timeout",
        events: [],
      },
      {
        id: "r3",
        taskId: "t1",
        agentId: "a1",
        status: "running",
        createdAt: since,
        startedAt: since,
        events: [],
      },
    ];

    const digest = buildAgentStandupDigest(
      runs,
      [task],
      [agent],
      [{ requestId: "p1", runId: "r3", taskId: "t1", toolUseId: "x", toolName: "bash", input: {}, receivedAt: new Date() }],
      { since },
    );

    expect(digest.completed).toHaveLength(1);
    expect(digest.failed).toHaveLength(1);
    expect(digest.totalCostUsd).toBe(1.75);
    expect(digest.pendingPermissions).toBe(1);
    expect(digest.activeRuns).toBe(1);
    expect(formatStandupDigestText(digest)).toContain("Agent standup");
  });
});
