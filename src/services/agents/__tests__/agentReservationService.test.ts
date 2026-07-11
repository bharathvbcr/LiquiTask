import { describe, expect, it, beforeEach } from "vitest";

import { COLUMN_STATUS } from "../../../constants";
import agentScopeService from "../agentScopeService";
import agentReservationService from "../agentReservationService";
import { declarePlannedScope, reservationPathsOverlap } from "../scopeHeuristic";
import type { Task } from "../../../types";

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    jobId: "1",
    projectId: "p1",
    title: "Fix login",
    subtitle: "",
    summary: "",
    assignee: "",
    priority: "medium",
    status: COLUMN_STATUS.TASK,
    createdAt: new Date(),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    ...overrides,
  }) as Task;

describe("scopeHeuristic", () => {
  beforeEach(() => {
    agentScopeService.resetForTests();
    agentReservationService.resetForTests();
  });

  it("detects path overlap for nested directories", () => {
    expect(reservationPathsOverlap("src/services", "src/services/foo.ts")).toBe(true);
    expect(reservationPathsOverlap("crates", "src")).toBe(false);
  });

  it("uses DevCouncil planned files when registered", () => {
    agentScopeService.setScopeForTask("t1", [
      { path: "src/auth.ts", reason: "login", allowedChange: "modify" },
    ]);
    expect(declarePlannedScope(task())).toEqual(["src/auth.ts"]);
  });

  it("heuristically extracts file paths from task text", () => {
    const paths = declarePlannedScope(
      task({ title: "Update src/services/agents/agentRunService.ts" }),
    );
    expect(paths).toContain("src/services/agents/agentRunService.ts");
  });
});

describe("agentReservationService", () => {
  beforeEach(() => {
    agentScopeService.resetForTests();
    agentReservationService.resetForTests();
  });

  it("claims, detects overlap, queues, and releases", async () => {
    agentScopeService.setScopeForTask("t1", [
      { path: "src/services", reason: "svc", allowedChange: "modify" },
    ]);
    const ok = await agentReservationService.claim("run-1", task({ id: "t1" }));
    expect(ok.ok).toBe(true);

    agentScopeService.setScopeForTask("t2", [
      { path: "src/services/foo.ts", reason: "nested", allowedChange: "modify" },
    ]);
    const blocked = await agentReservationService.claim("run-2", task({ id: "t2" }));
    expect(blocked.ok).toBe(false);
    expect(blocked.waitPosition).toBe(1);

    const next = await agentReservationService.release("run-1");
    expect(next?.runId).toBe("run-2");
  });
});
