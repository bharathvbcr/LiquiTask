import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../../../../types";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

const deadLetterMocks = vi.hoisted(() => {
  let retryHandler: ((letter: { id: string; payload: Record<string, unknown> }) => Promise<void>) | null =
    null;
  return {
    record: vi.fn(),
    registerRetryHandler: vi.fn((kind: string, handler: typeof retryHandler) => {
      if (kind === "mcp-action") retryHandler = handler;
    }),
    getRetryHandler: () => retryHandler,
  };
});

vi.mock("../../deadLetterService", () => ({
  default: {
    record: (...args: unknown[]) => deadLetterMocks.record(...args),
    registerRetryHandler: (...args: unknown[]) => deadLetterMocks.registerRetryHandler(...args),
  },
}));

vi.mock("../../storageService", () => ({
  default: { get: vi.fn(), set: vi.fn(async () => undefined) },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const updateTask = vi.fn();
const task: Task = {
  id: "task-1",
  title: "Fix bug",
  summary: "",
  status: "Completed",
  priority: "medium",
  projectId: "p1",
  createdAt: new Date(),
} as Task;

async function loadService() {
  vi.resetModules();
  const { default: agentMcpService } = await import("../agentMcpService");
  agentMcpService.setHooks({
    getTask: (id) => (id === "task-1" ? task : undefined),
    getColumns: () => [
      { id: "InProgress", title: "In Progress", isCompleted: false },
      { id: "Completed", title: "Completed", isCompleted: false },
      { id: "Commit", title: "Commit", isCompleted: true },
    ],
    updateTask,
    getRunsForTask: () => [],
  });
  return agentMcpService;
}

describe("agentMcpService DLQ retry idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateTask.mockClear();
  });

  it("skips complete_task retry when the task is already Completed", async () => {
    await loadService();
    const handler = deadLetterMocks.getRetryHandler();
    expect(handler).toBeTypeOf("function");
    await handler!({
      id: "dlq-1",
      payload: {
        tool: "complete_task",
        taskId: "task-1",
        args: { summary: "done" },
      },
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("skips update_status retry when the task is already at the target column", async () => {
    task.status = "InProgress";
    await loadService();
    const handler = deadLetterMocks.getRetryHandler();
    await handler!({
      id: "dlq-2",
      payload: {
        tool: "update_status",
        taskId: "task-1",
        args: { status: "InProgress" },
      },
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("re-applies update_status when the task is not yet at the target column", async () => {
    task.status = "Task";
    await loadService();
    const handler = deadLetterMocks.getRetryHandler();
    await handler!({
      id: "dlq-3",
      payload: {
        tool: "update_status",
        taskId: "task-1",
        args: { status: "InProgress" },
      },
    });
    expect(updateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "InProgress" }),
      expect.any(Object),
    );
  });
});
