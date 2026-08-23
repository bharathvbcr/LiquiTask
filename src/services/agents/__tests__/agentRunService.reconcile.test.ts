import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile, AgentRun, Task } from "../../../types";

// Force the Tauri code path and stub the native bridges the service imports.
vi.mock("../../../runtime/runtimeEnvironment", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => true,
  getDesktopApi: () => null,
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

import { agentRunService } from "../agentRunService";

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "queued",
    createdAt: new Date(),
    events: [],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-1",
    name: "Codey",
    provider: "claude-code",
    model: "",
    createdAt: new Date(),
    ...overrides,
  } as AgentProfile;
}

function makeTask(): Task {
  return {
    id: "task-1",
    title: "Fix bug",
    createdAt: new Date(),
  } as Task;
}

type Internals = {
  upsert(run: AgentRun): unknown;
  reconcileWithJournal(runs: AgentRun[]): Promise<void>;
  registerSchedulerIntent(
    run: AgentRun,
    task: Task,
    agent: AgentProfile,
    options?: { prompt?: string; cwd?: string; startParams?: Record<string, unknown> },
  ): Promise<void>;
};

const internals = agentRunService as unknown as Internals;

/** Let the debounced run-store persist settle so its dynamic imports don't race the journal read. */
const settlePersist = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("agentRunService relaunch reconcile", () => {
  afterEach(() => {
    invokeMock.mockReset();
  });

  it("keeps a daemon-reported queued run queued instead of finalizing it as failed", async () => {
    // Non-agentd journal path only — no engine === 'agentd' runs here.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return [{ runId: "run-1", alive: false, status: "queued" }];
      }
      return [];
    });

    const run = makeRun();
    internals.upsert(run);
    await settlePersist();
    await internals.reconcileWithJournal([run]);

    const stored = agentRunService.getRuns().find((r) => r.id === "run-1");
    expect(stored?.status).toBe("queued");
    expect(stored?.error).toBeUndefined();
    expect(stored?.finishedAt).toBeUndefined();
  });

  it("still finalizes a dead non-queued run with its real outcome", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return [{ runId: "run-1", alive: false, status: "failed" }];
      }
      return [];
    });

    const run = makeRun({ status: "running" });
    internals.upsert(run);
    await settlePersist();
    await internals.reconcileWithJournal([run]);

    const stored = agentRunService.getRuns().find((r) => r.id === "run-1");
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toBe("Agent run ended while the app was closed.");
    expect(stored?.finishedAt).toBeInstanceOf(Date);
  });

  it("treats an unknown journal status on a dead run as failed, not a crash", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return [{ runId: "run-1", alive: false, status: "paused-weird-future-state" }];
      }
      return [];
    });

    const run = makeRun({ status: "verifying" });
    internals.upsert(run);
    await settlePersist();
    await internals.reconcileWithJournal([run]);

    const stored = agentRunService.getRuns().find((r) => r.id === "run-1");
    expect(stored?.status).toBe("failed");
  });

  it("keeps a live run live even when the journal reports a terminal status", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return [{ runId: "run-1", alive: true, status: "completed" }];
      }
      return [];
    });

    const run = makeRun({ status: "verifying" });
    internals.upsert(run);
    await settlePersist();
    await internals.reconcileWithJournal([run]);

    const stored = agentRunService.getRuns().find((r) => r.id === "run-1");
    expect(stored?.status).toBe("verifying");
    expect(stored?.finishedAt).toBeUndefined();
  });

  it("ignores journal entries for runs it does not know", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return [{ runId: "ghost-run", alive: false, status: "completed" }];
      }
      return [];
    });

    const run = makeRun({ id: "run-1", status: "queued" });
    internals.upsert(run);
    await settlePersist();
    await internals.reconcileWithJournal([run]);

    // No info for run-1 → queued runs stay queued for queue rehydration.
    expect(agentRunService.getRuns().find((r) => r.id === "run-1")?.status).toBe("queued");
  });
});

describe("agentRunService scheduler intent registration", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(true);
  });

  it("maps profile autoRepair flags onto the daemon intent (no silent drop)", async () => {
    const agent = makeAgent({
      autoRepair: { ciFailures: true, reviewComments: false },
    });

    await internals.registerSchedulerIntent(makeRun(), makeTask(), agent);

    expect(invokeMock).toHaveBeenCalledWith(
      "agentd_scheduler_intent_set",
      expect.objectContaining({
        runId: "run-1",
        taskId: "task-1",
        autoRepairCi: true,
        autoRepairReview: false,
      }),
    );
  });

  it("defaults both repair flags to false when the profile opts out", async () => {
    await internals.registerSchedulerIntent(makeRun(), makeTask(), makeAgent());

    expect(invokeMock).toHaveBeenCalledWith(
      "agentd_scheduler_intent_set",
      expect.objectContaining({
        autoRepairCi: false,
        autoRepairReview: false,
      }),
    );
  });
});
