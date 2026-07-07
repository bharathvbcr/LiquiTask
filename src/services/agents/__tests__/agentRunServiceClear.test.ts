import { describe, expect, it, vi, type Mock } from "vitest";

// Force the Tauri path; stub the native bridges the service imports so
// initialize() hydrates purely from the mocked persisted store.
vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

import type { AgentRun } from "../../../../types";

const persisted = (
  id: string,
  status: AgentRun["status"],
  extra: Partial<AgentRun> = {},
) => ({
  id,
  taskId: `task-${id}`,
  agentId: `agent-${id}`,
  status,
  createdAt: new Date("2026-07-06T00:00:00.000Z").toISOString(),
  events: [],
  ...extra,
});

/**
 * Boot a *fresh* agentRunService singleton seeded with `seed`. The service is a
 * module-level singleton whose `initialize()` is idempotent, so each test resets
 * the module registry to avoid state bleeding between cases.
 */
async function bootWith(seed: unknown[]) {
  vi.resetModules();
  const storageService = (await import("../../storageService")).default as {
    get: Mock;
    set: Mock;
  };
  storageService.get.mockReturnValue(seed);
  const { agentRunService } = await import("../agentRunService");
  await agentRunService.initialize();
  return agentRunService;
}

describe("agentRunService clear / remove", () => {
  it("removeRun deletes a clean terminal run (and does not re-add it)", async () => {
    const svc = await bootWith([
      persisted("done", "completed", { agentdRunId: "sidecar-done" }),
      persisted("worktree", "failed", {
        worktreePath: "/tmp/wt",
        gitBranch: "agent/run-worktree",
      }),
    ]);
    expect(svc.getRuns()).toHaveLength(2);

    // Success path — regression guard for the upsert()-re-add bug.
    expect(svc.removeRun("done")).toBe(true);
    expect(svc.getRuns().map((r) => r.id)).toEqual(["worktree"]);
    // Removing again is a no-op now that it's gone.
    expect(svc.removeRun("done")).toBe(false);

    // A run with an unresolved worktree can't be single-removed.
    expect(svc.removeRun("worktree")).toBe(false);
    // Nor a run that never existed.
    expect(svc.removeRun("nope")).toBe(false);
  });

  it("clears terminal runs but keeps ones with a pending worktree", async () => {
    const svc = await bootWith([
      persisted("done", "completed"),
      persisted("failed", "failed"),
      persisted("cancelled", "cancelled"),
      persisted("worktree", "failed", {
        worktreePath: "/tmp/wt",
        gitBranch: "agent/run-worktree",
      }),
    ]);
    expect(svc.getRuns()).toHaveLength(4);

    const cleared = svc.clearFinishedRuns();
    expect(cleared).toBe(3); // done, failed, cancelled — not the worktree one

    expect(svc.getRuns().map((r) => r.id)).toEqual(["worktree"]);
    // A second bulk clear is a no-op.
    expect(svc.clearFinishedRuns()).toBe(0);
  });

  it("restoreRuns re-inserts a cleared snapshot (the Undo path)", async () => {
    const svc = await bootWith([
      persisted("done", "completed"),
      persisted("failed", "failed"),
    ]);
    // Snapshot before clearing, exactly as the UI's Undo affordance does.
    const snapshot = svc.getRuns();
    expect(snapshot).toHaveLength(2);
    expect(svc.clearFinishedRuns()).toBe(2);
    expect(svc.getRuns()).toHaveLength(0);

    // Undo restores every run in the snapshot…
    expect(svc.restoreRuns(snapshot)).toBe(2);
    expect(svc.getRuns().map((r) => r.id).sort()).toEqual(["done", "failed"]);
    // …and is idempotent — a second restore adds nothing (already present).
    expect(svc.restoreRuns(snapshot)).toBe(0);
  });

  it("restoreRuns refuses non-terminal runs (never resurrects a live run)", async () => {
    const svc = await bootWith([persisted("done", "completed")]);
    const live = { ...svc.getRuns()[0], id: "live", status: "running" } as AgentRun;
    expect(svc.restoreRuns([live])).toBe(0);
    expect(svc.getRuns().map((r) => r.id)).toEqual(["done"]);
  });
});
