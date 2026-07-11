import { describe, expect, it, vi, type Mock } from "vitest";
import type { AgentRun } from "../../../../types";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
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

const persisted = (id: string, extra: Partial<AgentRun>) => ({
  id,
  taskId: `task-${id}`,
  agentId: `agent-${id}`,
  status: "failed" as const,
  createdAt: new Date("2026-07-06T00:00:00.000Z").toISOString(),
  events: [],
  ...extra,
});

async function bootWith(seed: unknown[]) {
  vi.resetModules();
  const storageService = (await import("../../storageService")).default as {
    get: Mock;
    set: Mock;
  };
  storageService.get.mockReturnValue(seed);
  const { agentRunService } = await import("../agentRunService");
  await agentRunService.initialize();
  const { invoke } = await import("@tauri-apps/api/core");
  return { svc: agentRunService, invoke: invoke as unknown as Mock };
}

describe("agentRunService repo-dir binding", () => {
  it("discardWorktree targets the run's persisted repoDir even with no live context", async () => {
    // Simulates a run reloaded after a relaunch: no runContext was rehydrated,
    // so the old code would fall back to the agent profile's (stale) folder.
    const { svc, invoke } = await bootWith([
      persisted("wt", {
        repoDir: "/repos/portfolio",
        worktreePath: "/repos/portfolio/.worktrees/run-wt",
        gitBranch: "agent/run-wt",
      }),
    ]);
    invoke.mockClear();

    const run = svc.getRuns().find((r) => r.id === "wt");
    expect(run?.repoDir).toBe("/repos/portfolio"); // survived revive

    await svc.discardWorktree(run as AgentRun);
    expect(invoke).toHaveBeenCalledWith(
      "agent_git_discard_worktree",
      expect.objectContaining({ repoDir: "/repos/portfolio" }),
    );
  });

  it("falls back to deriving the repo from the worktree path when repoDir is absent", async () => {
    // Older runs persisted before repoDir existed still discard correctly.
    const { svc, invoke } = await bootWith([
      persisted("legacy", {
        worktreePath: "/repos/legacy/.worktrees/run-legacy",
        gitBranch: "agent/run-legacy",
      }),
    ]);
    invoke.mockClear();

    const run = svc.getRuns().find((r) => r.id === "legacy");
    await svc.discardWorktree(run as AgentRun);
    expect(invoke).toHaveBeenCalledWith(
      "agent_git_discard_worktree",
      expect.objectContaining({ repoDir: "/repos/legacy" }),
    );
  });

  it("openPullRequest uses run.repoDir instead of the agent profile folder", async () => {
    const { svc, invoke } = await bootWith([
      persisted("pr-run", {
        repoDir: "/repos/portfolio",
        gitBranch: "agent/pr-run",
      }),
    ]);
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_git_create_pr") return { url: "https://github.com/pr/1" };
      return undefined;
    });

    const run = svc.getRuns().find((r) => r.id === "pr-run") as AgentRun;
    await svc.openPullRequest(run, "Ship it");

    expect(invoke).toHaveBeenCalledWith(
      "agent_git_create_pr",
      expect.objectContaining({ workingDir: "/repos/portfolio" }),
    );
  });
});
