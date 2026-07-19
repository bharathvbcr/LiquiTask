import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Force the Tauri code path and stub the native bridges the service imports.
vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

import storageService from "../../storageService";
import { agentRunService } from "../agentRunService";
import type { AgentRun } from "../../../../types";

/** Minimal persisted run record shaped like what storageService returns. */
const persistedRun = (id: string, status: AgentRun["status"], boardSynced?: boolean) => ({
  id,
  taskId: `task-${id}`,
  agentId: `agent-${id}`,
  status,
  boardSynced,
  createdAt: new Date("2026-07-05T00:00:00.000Z").toISOString(),
  events: [],
});

describe("agentRunService reattach + retro-drive (Runtime v2)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reconciles reattached runs and retro-drives the board for while-away completions", async () => {
    (storageService.get as Mock).mockReturnValue([
      persistedRun("r-alive", "running"),
      persistedRun("r-done", "running"),
      persistedRun("r-failed", "running"),
      persistedRun("r-unknown", "verifying"),
      persistedRun("r-old", "completed", true), // terminal already — must be left alone
    ]);

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return Promise.resolve([
          { runId: "r-alive", alive: true, status: "running", sessionId: "sess-alive" },
          {
            runId: "r-done",
            alive: false,
            status: "completed",
            summary: "shipped the feature",
            sessionId: "sess-done",
          },
          { runId: "r-failed", alive: false, status: "failed" },
        ]);
      }
      return Promise.resolve(undefined);
    });

    await agentRunService.initialize();

    expect(invokeMock).toHaveBeenCalledWith("agent_runs_reattach");

    const runs = new Map(agentRunService.getRuns().map((r) => [r.id, r]));

    // Still running headless — kept live, session id adopted.
    const alive = runs.get("r-alive")!;
    expect(alive.status).toBe("running");
    expect(alive.sessionId).toBe("sess-alive");
    expect(alive.events.some((e) => e.text.includes("Reattached"))).toBe(true);

    // Finished while away — finalized from the durable log.
    expect(runs.get("r-done")!.status).toBe("completed");
    expect(runs.get("r-done")!.summary).toBe("shipped the feature");
    expect(runs.get("r-failed")!.status).toBe("failed");

    // Journal never heard of it — interrupted, as before.
    expect(runs.get("r-unknown")!.status).toBe("failed");
    expect(runs.get("r-unknown")!.error).toMatch(/Interrupted by app restart/);

    // Already-terminal run untouched.
    expect(runs.get("r-old")!.status).toBe("completed");

    // Retro-drive: only the while-away *finished* runs replay onRunFinished,
    // and only once — reattached-live and interrupted runs are excluded.
    const onRunFinished = vi.fn();
    agentRunService.setTaskHooks({ onRunFinished });
    agentRunService.flushPendingBoardSync();

    const drivenTaskIds = onRunFinished.mock.calls.map((c) => c[0]).sort();
    expect(drivenTaskIds).toEqual(["task-r-done", "task-r-failed"]);

    // A second flush is a no-op (the queue was drained).
    onRunFinished.mockClear();
    agentRunService.flushPendingBoardSync();
    expect(onRunFinished).not.toHaveBeenCalled();
  });
});
