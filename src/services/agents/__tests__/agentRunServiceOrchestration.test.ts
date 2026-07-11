import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AgentProfile, AgentRun, Task } from "../../../../types";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  __esModule: true,
  invoke: invokeMock,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("../../../core/events/taskEventStore", () => ({
  __esModule: true,
  default: { appendSafe: vi.fn(async () => true) },
}));
vi.mock("../../deadLetterService", () => ({
  __esModule: true,
  default: { record: vi.fn(), registerRetryHandler: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));
vi.mock("../agentMcpService", () => ({
  __esModule: true,
  default: {
    denyAllForRun: vi.fn(),
    cleanup: vi.fn(async () => undefined),
    prepareMcpConfig: vi.fn(async () => "/tmp/mcp.json"),
    prepareAgentdMcpConfig: vi.fn(async () => "{}"),
  },
}));
const { mergePipelineRunMock } = vi.hoisted(() => ({
  mergePipelineRunMock: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("../mergePipelineService", () => ({
  mergePipelineService: {
    run: mergePipelineRunMock,
  },
}));
vi.mock("../agentScopeService", () => ({
  __esModule: true,
  default: {
    bindTaskScopeToRun: vi.fn(),
    setRunRoot: vi.fn(),
    clearScopeForRun: vi.fn(),
  },
}));

const storage = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  get: vi.fn((key: string, fallback: unknown) => storage.data.get(key) ?? fallback),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.data.set(key, value);
  }),
}));

vi.mock("../../storageService", () => ({
  __esModule: true,
  default: storage,
}));

const agent: AgentProfile = {
  id: "agent-1",
  name: "Worker",
  provider: "claude-code",
  workingDir: "/repo/main",
  permissionMode: "acceptEdits",
  sandbox: "host",
  autoPickup: true,
  runsOnRecurrence: false,
  devCouncilVerify: false,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

const task: Task = {
  id: "task-1",
  title: "Do work",
  summary: "",
  status: "InProgress",
  priority: "medium",
  projectId: "p1",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
} as Task;

async function boot(seed?: () => void, invokeImpl?: (cmd: string) => unknown) {
  vi.resetModules();
  storage.data.clear();
  mergePipelineRunMock.mockReset();
  mergePipelineRunMock.mockImplementation(() => new Promise(() => undefined));
  seed?.();
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (invokeImpl) {
      const custom = invokeImpl(cmd);
      if (custom !== undefined) return custom;
    }
    if (cmd === "agent_runs_reattach") return Promise.resolve([]);
    if (cmd === "agentd_run_start") return Promise.resolve("sidecar-1");
    if (cmd === "agent_git_create_worktree") {
      return Promise.resolve({
        branch: "agent/run-1",
        worktreePath: "/repo/main/.worktrees/run-1",
      });
    }
    if (cmd === "agent_git_create_pr") return Promise.resolve({ url: "https://github.com/pr/1" });
    if (cmd === "agent_build_task_prompt") return Promise.resolve("task prompt");
    if (cmd === "agent_git_prune_worktrees") return Promise.resolve(0);
    return Promise.resolve(undefined);
  });
  vi.stubGlobal("window", {
    ...(globalThis.window as object | undefined),
    __TAURI_INTERNALS__: { invoke: invokeMock },
  });
  const { agentRunService } = await import("../agentRunService");
  await agentRunService.initialize();
  return agentRunService;
}

describe("agentRunService orchestration hardening", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("routes cancel through finishRun hooks and releases the agent queue", async () => {
    const svc = await boot();
    const onRunFinished = vi.fn();
    svc.setTaskHooks({ onRunFinished });

    const run = await svc.assign(task, agent);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");

    await svc.cancel(run!.id);

    expect(run!.status).toBe("cancelled");
    expect(onRunFinished).toHaveBeenCalledWith(task.id, expect.objectContaining({ id: run!.id }));
  });

  it("falls back to deriving the repo from the worktree path when repoDir is absent", async () => {
    const svc = await boot();
    const run = await svc.assign(task, agent);
    expect(run).not.toBeNull();
    run!.sessionId = "sess-1";
    run!.status = "completed";
    run!.worktreePath = "/repo/main/.worktrees/run-1";
    run!.gitBranch = "agent/run-1";

    void svc.mergeWorktree(run!);
    await expect(svc.followUp(run!.id, "fix tests")).rejects.toThrow(/merge is in progress/);
  });

  it("passes agent commitStage into mergePipelineService.run", async () => {
    const svc = await boot();
    mergePipelineRunMock.mockResolvedValueOnce({ result: { message: "PR opened" } });
    const run = await svc.assign(task, { ...agent, commitStage: "pushPr" });
    expect(run).not.toBeNull();
    run!.status = "completed";
    run!.worktreePath = "/repo/main/.worktrees/run-1";
    run!.gitBranch = "agent/run-1";

    await svc.mergeWorktree(run!);

    expect(mergePipelineRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commitStage: "pushPr",
      }),
    );
  });

  it("rehydrates queued runs and finalizes ghost runs with missing task/agent", async () => {
    const svc = await boot(
      () => {
        storage.data.set("liquitask-agent-runs", [
          {
            id: "run-queued",
            taskId: "task-q",
            agentId: "agent-1",
            status: "queued",
            createdAt: new Date("2026-07-06T00:00:00.000Z").toISOString(),
            events: [],
            repoDir: "/repo/main",
          },
          {
            id: "run-ghost",
            taskId: "task-missing",
            agentId: "agent-1",
            status: "running",
            createdAt: new Date("2026-07-06T00:00:00.000Z").toISOString(),
            events: [],
            repoDir: "/repo/main",
          },
        ]);
      },
      (cmd) => {
        if (cmd === "agent_runs_reattach") {
          return Promise.resolve([{ runId: "run-ghost", alive: true, status: "running" }]);
        }
        return undefined;
      },
    );
    const onRunFinished = vi.fn();
    svc.setTaskHooks({ onRunFinished });

    svc.rehydrateActiveRuns(
      (run) => {
        if (run.id === "run-queued") return { task: { ...task, id: "task-q" }, agent };
        return null;
      },
      (taskId, agentId) => {
        if (taskId === "task-q" && agentId === "agent-1") {
          return { task: { ...task, id: "task-q" }, agent };
        }
        return null;
      },
    );

    expect(svc.getQueuePosition("task-q")).toBe(1);
    const ghost = svc.getRuns().find((r) => r.id === "run-ghost");
    expect(ghost?.status).toBe("failed");
    expect(ghost?.error).toMatch(/could not be restored/);
    expect(onRunFinished).toHaveBeenCalledWith(
      "task-missing",
      expect.objectContaining({ id: "run-ghost" }),
    );
  });

  it("persists the per-agent queue on assign", async () => {
    const svc = await boot();
    const taskTwo = { ...task, id: "task-2", title: "Second" };

    await svc.assign(task, agent);
    await svc.assign(taskTwo, agent);

    expect(svc.getQueueLengthForAgent("agent-1")).toBe(1);
    expect(svc.getQueuePosition("task-2")).toBe(1);
  });

  it("fails the run and dead-letters when worktree creation fails (fail closed)", async () => {
    const deadLetter = await import("../../deadLetterService");
    const svc = await boot(undefined, (cmd) => {
      if (cmd === "agent_git_create_worktree") return Promise.reject(new Error("disk full"));
      return undefined;
    });
    const run = await svc.assign(task, agent);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("failed");
    expect(run!.error).toMatch(/worktree required/i);
    expect(deadLetter.default.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "run", taskId: "task-1" }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("agentd_run_start", expect.anything());
  });

  it("continues on main checkout when allowMainCheckout is enabled", async () => {
    const svc = await boot(undefined, (cmd) => {
      if (cmd === "agent_git_create_worktree") return Promise.reject(new Error("disk full"));
      return undefined;
    });
    const run = await svc.assign(task, { ...agent, allowMainCheckout: true });
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_start", expect.anything());
  });

  it("passes confirmPruneAll when pruning with no runs to keep", async () => {
    const svc = await boot();
    await svc.pruneStaleWorktrees([agent]);
    expect(invokeMock).toHaveBeenCalledWith(
      "agent_git_prune_worktrees",
      expect.objectContaining({
        repoDir: "/repo/main",
        keepRunIds: [],
        confirmPruneAll: true,
      }),
    );
  });

  it("persists runs with worktrees even when over MAX_PERSISTED_RUNS", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const seeded: AgentRun[] = [];
    for (let i = 0; i < 105; i += 1) {
      seeded.push({
        id: `run-${i}`,
        taskId: `task-${i}`,
        agentId: "agent-1",
        status: "completed",
        createdAt: new Date(now - i * 1000),
        events: [],
        ...(i < 5 ? { worktreePath: `/repo/main/.worktrees/run-${i}` } : {}),
      } as AgentRun);
    }
    const svc = await boot(() => {
      storage.data.set("liquitask-agent-runs", seeded);
    });
    svc.setWorkspaceResolver(() => ({
      ok: true as const,
      agent: { ...agent, workingDir: "/repo/main" },
    }));
    await svc.assign({ ...task, id: "task-trigger" }, agent);
    await vi.advanceTimersByTimeAsync(1100);
    const persisted = storage.set.mock.calls.find(
      (c) => c[0] === "liquitask-agent-runs",
    )?.[1] as AgentRun[] | undefined;
    expect(persisted).toBeDefined();
    expect(persisted!.filter((r) => r.worktreePath).length).toBeGreaterThanOrEqual(5);
    expect(persisted!.length).toBeGreaterThanOrEqual(100);
    vi.useRealTimers();
  });

  it("blocks assign until signalReady when active runs need rehydrate", async () => {
    vi.useRealTimers();
    vi.resetModules();
    storage.data.clear();
    storage.data.set("liquitask-agent-runs", [
      {
        id: "run-live",
        taskId: "task-1",
        agentId: "agent-1",
        status: "running",
        createdAt: new Date().toISOString(),
        events: [],
        repoDir: "/repo/main",
      },
    ]);
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "agent_runs_reattach") {
        return Promise.resolve([{ runId: "run-live", alive: true, status: "running" }]);
      }
      return Promise.resolve(undefined);
    });
    const { agentRunService: svc } = await import("../agentRunService");
    await svc.initialize();
    expect(svc.isReady()).toBe(false);

    let assigned = false;
    const pending = svc.assign({ ...task, id: "task-new" }, agent).then((run) => {
      if (run) assigned = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(assigned).toBe(false);

    svc.rehydrateActiveRuns((run) =>
      run.id === "run-live" ? { task, agent } : null,
    );
    svc.signalReady();
    await pending;
    expect(assigned).toBe(true);
  });
});
