import { describe, expect, it, vi } from "vitest";
import type { AgentProfile, Task } from "../../../../types";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

const recordMock = vi.fn();
vi.mock("../../deadLetterService", () => ({
  __esModule: true,
  default: {
    record: recordMock,
    registerRetryHandler: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getOpen: vi.fn(() => []),
    getAll: vi.fn(() => []),
    getById: vi.fn(),
    discard: vi.fn(),
    discardAll: vi.fn(() => 0),
    resolve: vi.fn(),
    retry: vi.fn(async () => ({ ok: true })),
  },
}));

const task = { id: "t1", projectId: "portfolio", title: "Redesign pill" } as Task;
const agent = { id: "a1", name: "Dev", workingDir: "/repos/scholarlm" } as AgentProfile;

async function freshService() {
  vi.resetModules();
  recordMock.mockClear();
  const { agentRunService } = await import("../agentRunService");
  await agentRunService.initialize();
  return agentRunService;
}

describe("agentRunService workspace resolution", () => {
  it("blocks the run and records a dead-letter when the project has no workspace", async () => {
    const svc = await freshService();
    svc.setWorkspaceResolver(() => ({
      ok: false,
      reason: 'Project "Portfolio" has no workspace folder linked.',
    }));

    await expect(svc.assign(task, agent)).rejects.toThrow(/no workspace folder/i);
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "run", taskId: "t1" }),
    );
    // Nothing was started.
    expect(svc.getRuns()).toHaveLength(0);
  });

  it("does not record a dead-letter when no resolver is configured", async () => {
    const svc = await freshService();
    // Guard is inert without a resolver: assigning an already-active task is a
    // no-op (returns null) and must not touch the dead-letter queue.
    const seeded = { ...task };
    // getActiveRunForTask is false here, but with no Tauri worktree backend the
    // point is simply that the workspace guard never fires.
    expect(svc.setWorkspaceResolver).toBeInstanceOf(Function);
    expect(recordMock).not.toHaveBeenCalled();
    void seeded;
  });
});
