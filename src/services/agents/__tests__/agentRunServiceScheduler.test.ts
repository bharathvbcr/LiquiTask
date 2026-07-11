import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile, Task } from "../../../types";

vi.mock("../../../runtime/runtimeEnvironment", () => ({
  isTauri: () => true,
  callNative: vi.fn(async () => ({ captured: false, skills: [] })),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const schedulerHandlers: Array<(payload: unknown) => void> = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((channel: string, handler: (event: { payload: unknown }) => void) => {
    if (channel === "agentd-scheduler-event") {
      schedulerHandlers.push((payload) => handler({ payload }));
    }
    return Promise.resolve(() => undefined);
  }),
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
vi.mock("../agentScopeService", () => ({
  __esModule: true,
  default: {
    bindTaskScopeToRun: vi.fn(),
    setRunRoot: vi.fn(),
    getScopeForTask: vi.fn(() => []),
    claim: vi.fn(async () => ({ ok: true, paths: [] })),
    release: vi.fn(async () => null),
  },
}));
vi.mock("../agentReservationService", () => ({
  __esModule: true,
  default: {
    claim: vi.fn(async () => ({ ok: true, paths: [] })),
    release: vi.fn(async () => null),
    refresh: vi.fn(async () => undefined),
  },
}));
vi.mock("../feedbackLoopService", () => ({
  __esModule: true,
  default: { startPolling: vi.fn(), stopPolling: vi.fn(), onRunFinished: vi.fn() },
}));
vi.mock("../mergePipelineService", () => ({
  mergePipelineService: { run: vi.fn(), retryFromDeadLetter: vi.fn() },
}));
vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

const agent: AgentProfile = {
  id: "agent-1",
  name: "Worker",
  provider: "codex",
  workingDir: "/repo",
  permissionMode: "acceptEdits",
  sandbox: "host",
  autoPickup: true,
  runsOnRecurrence: false,
  devCouncilVerify: false,
  gitWorktree: false,
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

async function boot() {
  vi.resetModules();
  schedulerHandlers.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "agent_runs_reattach") return Promise.resolve([]);
    if (cmd === "agentd_run_start") return Promise.resolve("sidecar-1");
    if (cmd === "agentd_queue_list") {
      return Promise.resolve({ activeByAgent: { "agent-1": "run-1" }, queue: [] });
    }
    if (cmd === "agentd_queue_acquire") return Promise.resolve(true);
    if (cmd === "agentd_queue_enqueue") return Promise.resolve(1);
    if (cmd === "agentd_scheduler_intent_set") return Promise.resolve(true);
    if (cmd === "agentd_scheduler_config_set") return Promise.resolve(true);
    if (cmd === "agent_build_task_prompt") return Promise.resolve("prompt");
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

describe("agentRunService scheduler events", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("registers scheduler intent on assign", async () => {
    const svc = await boot();
    await svc.assign(task, agent);
    expect(invokeMock).toHaveBeenCalledWith(
      "agentd_scheduler_intent_set",
      expect.objectContaining({ runId: expect.any(String), taskId: "task-1", agentId: "agent-1" }),
    );
  });

  it("finishes run from scheduler.run.finished without local dequeue", async () => {
    const svc = await boot();
    const onRunFinished = vi.fn();
    svc.setTaskHooks({ onRunFinished });
    const run = await svc.assign(task, agent);
    expect(run).not.toBeNull();

    const handler = schedulerHandlers[0];
    expect(handler).toBeDefined();
    handler({
      kind: "scheduler.run.finished",
      runId: run!.id,
      localRunId: run!.id,
      taskId: task.id,
      agentId: agent.id,
      status: "completed",
      sessionId: "sess-1",
    });

    expect(run!.status).toBe("completed");
    expect(onRunFinished).toHaveBeenCalledWith(task.id, expect.objectContaining({ id: run!.id }));
    expect(invokeMock).not.toHaveBeenCalledWith("agentd_queue_release", expect.anything());
  });

  it("starts dequeued run when scheduler.dequeued fires", async () => {
    const svc = await boot();
    const queued = {
      id: "run-queued",
      taskId: "task-2",
      agentId: "agent-1",
      status: "queued" as const,
      createdAt: new Date(),
      events: [],
      repoDir: "/repo",
      scopeBlocked: false,
    };
    (svc as unknown as { runs: Map<string, typeof queued> }).runs.set("run-queued", queued);
    (svc as unknown as { runContext: Map<string, { task: Task; agent: AgentProfile }> }).runContext.set(
      "run-queued",
      { task: { ...task, id: "task-2" }, agent },
    );

    const handler = schedulerHandlers[0];
    handler({
      kind: "scheduler.dequeued",
      runId: "run-queued",
      localRunId: "run-queued",
      taskId: "task-2",
      agentId: "agent-1",
      status: "queued",
    });

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("agentd_run_start", expect.anything());
    });
  });

  it("records verify gate outcome from scheduler.gate.failed", async () => {
    const svc = await boot();
    const run = await svc.assign(task, agent);
    const handler = schedulerHandlers[0];
    handler({
      kind: "scheduler.gate.failed",
      runId: run!.id,
      localRunId: run!.id,
      taskId: task.id,
      agentId: agent.id,
      payload: {
        verification: { passed: false, blockingGaps: ["missing test"], raw: "{}" },
      },
    });
    expect(run!.verification?.passed).toBe(false);
    expect(run!.verification?.blockingGaps).toEqual(["missing test"]);
  });
});
