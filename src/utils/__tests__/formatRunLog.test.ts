import { describe, expect, it } from "vitest";
import type { AgentRun } from "../../../types";
import { formatRunLog } from "../formatRunLog";

const run = (over: Partial<AgentRun> = {}): AgentRun =>
  ({
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "failed",
    createdAt: new Date("2026-07-07T02:00:00.000Z"),
    events: [
      { ts: new Date("2026-07-07T02:00:01.000Z"), kind: "info", text: "picked up" },
      { ts: new Date("2026-07-07T02:00:02.000Z"), kind: "stderr", text: "boom" },
    ],
    ...over,
  }) as AgentRun;

describe("formatRunLog", () => {
  it("includes a header and timestamped events", () => {
    const log = formatRunLog(run({ gitBranch: "agent/run-1", error: "killed", costUsd: 3.17 }), {
      title: "Redesign the pill",
      jobId: "TSK-8695",
    });
    expect(log).toContain("Task: Redesign the pill (TSK-8695)");
    expect(log).toContain("Run: run-1");
    expect(log).toContain("Status: failed");
    expect(log).toContain("Branch: agent/run-1");
    expect(log).toContain("Cost: $3.17");
    expect(log).toContain("Error: killed");
    expect(log).toContain("[2026-07-07T02:00:02.000Z] stderr: boom");
  });

  it("falls back to the task id and notes empty output", () => {
    const log = formatRunLog(run({ events: [], gitBranch: undefined }));
    expect(log).toContain("Task: task-1");
    expect(log).toContain("(no output)");
    expect(log).not.toContain("Branch:");
  });
});
