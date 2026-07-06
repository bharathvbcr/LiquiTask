import { describe, expect, it } from "vitest";
import { COLUMN_STATUS } from "../../../constants";
import { deriveInboxCounts, isAwaitingReview, isBlockedRun } from "../deriveInboxItems";
import type { AgentRun, Task } from "../../../../types";

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "completed",
    createdAt: new Date("2026-07-06T00:00:00Z"),
    events: [],
    ...overrides,
  } as AgentRun;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    jobId: "",
    projectId: "p1",
    title: "Test task",
    subtitle: "",
    summary: "",
    assignee: "",
    priority: "medium",
    status: COLUMN_STATUS.IN_PROGRESS,
    createdAt: new Date("2026-07-06T00:00:00Z"),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    ...overrides,
  } as Task;
}

describe("isAwaitingReview", () => {
  it("is true for a completed run with no verdict whose task sits in Review", () => {
    const run = makeRun({ status: "completed" });
    const task = makeTask({ status: COLUMN_STATUS.REVIEW });
    expect(isAwaitingReview(run, task)).toBe(true);
  });

  it("is false once a review outcome has been recorded", () => {
    const run = makeRun({ status: "completed", reviewOutcome: "approved" });
    const task = makeTask({ status: COLUMN_STATUS.REVIEW });
    expect(isAwaitingReview(run, task)).toBe(false);
  });

  it("is false when the task isn't sitting in Review", () => {
    const run = makeRun({ status: "completed" });
    const task = makeTask({ status: COLUMN_STATUS.IN_PROGRESS });
    expect(isAwaitingReview(run, task)).toBe(false);
  });

  it("is false for a non-completed run", () => {
    const run = makeRun({ status: "running" });
    const task = makeTask({ status: COLUMN_STATUS.REVIEW });
    expect(isAwaitingReview(run, task)).toBe(false);
  });
});

describe("isBlockedRun", () => {
  it("is true for a failed run with failing verification", () => {
    const run = makeRun({
      status: "failed",
      verification: { passed: false, blockingGaps: ["missing tests"] },
    });
    expect(isBlockedRun(run)).toBe(true);
  });

  it("is true for a running, paused run", () => {
    const run = makeRun({ status: "running", isPaused: true });
    expect(isBlockedRun(run)).toBe(true);
  });

  it("is true when the error text mentions permission or blocked", () => {
    expect(isBlockedRun(makeRun({ status: "failed", error: "Permission denied" }))).toBe(true);
    expect(isBlockedRun(makeRun({ status: "failed", error: "worktree blocked" }))).toBe(true);
  });

  it("is false for a plain completed run", () => {
    expect(isBlockedRun(makeRun({ status: "completed" }))).toBe(false);
  });
});

describe("deriveInboxCounts", () => {
  it("counts approvals and blocked runs separately, summing into actionable", () => {
    const tasks = [
      makeTask({ id: "t1", status: COLUMN_STATUS.REVIEW }),
      makeTask({ id: "t2", status: COLUMN_STATUS.IN_PROGRESS }),
    ];
    const runs = [
      makeRun({ id: "r1", taskId: "t1", status: "completed" }), // awaiting review
      makeRun({
        id: "r2",
        taskId: "t2",
        status: "failed",
        verification: { passed: false, blockingGaps: ["x"] },
      }), // blocked
      makeRun({ id: "r3", taskId: "t2", status: "completed" }), // plain finished, not actionable
    ];
    expect(deriveInboxCounts(runs, tasks)).toEqual({ approvals: 1, blocked: 1, actionable: 2 });
  });

  it("returns all zeros for an empty run list", () => {
    expect(deriveInboxCounts([], [])).toEqual({ approvals: 0, blocked: 0, actionable: 0 });
  });
});
