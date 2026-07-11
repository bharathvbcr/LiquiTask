import { describe, expect, it } from "vitest";

import { COLUMN_STATUS } from "../../../constants";
import { deriveAttentionLane } from "../deriveAttentionLane";
import type { AgentPermissionRequest, AgentRun, Task } from "../../../types";

const baseTask = (id: string, overrides: Partial<Task> = {}): Task =>
  ({
    id,
    jobId: id,
    projectId: "p1",
    title: `Task ${id}`,
    subtitle: "",
    summary: "",
    assignee: "Agent",
    priority: "medium",
    status: COLUMN_STATUS.IN_PROGRESS,
    createdAt: new Date(),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    ...overrides,
  }) as Task;

const baseRun = (overrides: Partial<AgentRun> = {}): AgentRun =>
  ({
    id: "run-1",
    taskId: "t1",
    agentId: "a1",
    status: "running",
    createdAt: new Date(),
    events: [],
    ...overrides,
  }) as AgentRun;

describe("deriveAttentionLane", () => {
  it("includes tasks with pending permissions", () => {
    const perms: AgentPermissionRequest[] = [
      {
        runId: "run-1",
        taskId: "t1",
        requestId: "req-1",
        toolName: "Write",
        input: {},
        receivedAt: new Date(),
      },
    ];
    const items = deriveAttentionLane({
      tasks: [baseTask("t1")],
      runs: [baseRun()],
      pendingPermissions: perms,
    });
    expect(items).toHaveLength(1);
    expect(items[0].reasons).toContain("pending-permission");
  });

  it("includes verify-failed runs", () => {
    const items = deriveAttentionLane({
      tasks: [baseTask("t1")],
      runs: [
        baseRun({
          status: "failed",
          verification: { passed: false, blockingGaps: ["tests"] },
        }),
      ],
      pendingPermissions: [],
    });
    expect(items[0].reasons).toContain("verify-failed");
  });

  it("includes tasks awaiting approval", () => {
    const items = deriveAttentionLane({
      tasks: [baseTask("t1", { status: COLUMN_STATUS.COMPLETED })],
      runs: [baseRun({ status: "completed" })],
      pendingPermissions: [],
    });
    expect(items[0].reasons).toContain("needs-approval");
  });

  it("includes tasks with open blockers", () => {
    const items = deriveAttentionLane({
      tasks: [
        baseTask("t1", {
          links: [{ type: "blocked-by", targetTaskId: "t2" }],
        }),
        baseTask("t2", { status: COLUMN_STATUS.IN_PROGRESS }),
      ],
      runs: [],
      pendingPermissions: [],
    });
    expect(items.some((i) => i.taskId === "t1" && i.reasons.includes("blocker-reported"))).toBe(
      true,
    );
  });
});
