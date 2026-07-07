import { describe, expect, it, vi, type Mock } from "vitest";
import type { AgentProfile, Task } from "../../../../types";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === "agent_runs_reattach") {
    return [{ runId: "r1", alive: true, status: "running", sessionId: "s1" }];
  }
  return true;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string])) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));
vi.mock("../../../core/events/taskEventStore", () => ({
  __esModule: true,
  default: { appendSafe: vi.fn(async () => true) },
}));
vi.mock("../../deadLetterService", () => ({
  __esModule: true,
  default: { record: vi.fn(), registerRetryHandler: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));

const OLD = 1_000_000;
const seedRun = {
  id: "r1",
  taskId: "t1",
  agentId: "a1",
  status: "running" as const,
  createdAt: new Date(OLD).toISOString(),
  startedAt: new Date(OLD).toISOString(),
  events: [{ ts: new Date(OLD).toISOString(), kind: "assistant", text: "x" }],
};

async function boot(stallMinutes: number) {
  vi.resetModules();
  invokeMock.mockClear();
  const storageService = (await import("../../storageService")).default as { get: Mock };
  storageService.get.mockReturnValue([seedRun]);
  const { agentRunService } = await import("../agentRunService");
  await agentRunService.initialize();
  agentRunService.rehydrateActiveRuns(() => ({
    task: { id: "t1", title: "T" } as Task,
    agent: { id: "a1", name: "Dev", stallTimeoutMinutes: stallMinutes } as AgentProfile,
  }));
  return agentRunService;
}

/** Poll until `pred` holds — robust to abortRun's async import/await chain. */
async function waitFor(pred: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("agentRunService guardrails", () => {
  it("aborts a stalled run, marks it failed, and fires onRunAborted", async () => {
    const svc = await boot(1); // stall after 1 minute of silence
    const aborted: Array<{ taskId: string; id: string; reason: string }> = [];
    svc.setTaskHooks({
      onRunAborted: (taskId, run, reason) => aborted.push({ taskId, id: run.id, reason }),
    });

    // Reconcile pushes a "still working" reattach event at boot (real time),
    // which correctly resets the stall clock — so evaluate 5 min past *now*.
    const ids = svc.enforceRunLimits(Date.now() + 5 * 60_000);
    expect(ids).toEqual(["r1"]);
    await waitFor(() => svc.getRuns().find((r) => r.id === "r1")?.status === "failed");

    const run = svc.getRuns().find((r) => r.id === "r1");
    expect(run?.status).toBe("failed");
    expect(run?.failureKind).toBe("stall");
    expect(aborted).toEqual([{ taskId: "t1", id: "r1", reason: "stall" }]);
  });

  it("leaves a run alone while within its limits", async () => {
    const svc = await boot(30); // 30-minute stall window
    // Only 2 minutes past the reattach event — well within the 30-min window.
    expect(svc.enforceRunLimits(Date.now() + 2 * 60_000)).toEqual([]);
    expect(svc.getRuns().find((r) => r.id === "r1")?.status).toBe("running");
  });
});
