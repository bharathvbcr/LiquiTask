import { beforeEach, describe, expect, it, vi } from "vitest";

const saveAgent = vi.fn(async (agent: unknown) => [agent]);
const getAgentById = vi.fn();
const getRuns = vi.fn(() => [] as Array<{ id: string; agentId: string }>);

vi.mock("../agentService", () => ({
  default: {
    getAgentById: (...args: unknown[]) => getAgentById(...args),
    saveAgent: (...args: unknown[]) => saveAgent(...args),
  },
}));

vi.mock("../agentRunService", () => ({
  default: {
    getRuns: (...args: unknown[]) => getRuns(...args),
  },
}));

describe("agentMcpService permission responses", () => {
  beforeEach(() => {
    vi.resetModules();
    saveAgent.mockClear();
    getAgentById.mockReset();
    getRuns.mockReset();
    getRuns.mockReturnValue([]);
  });

  it("persists always-allow into the owning agent toolPolicy", async () => {
    getRuns.mockReturnValue([{ id: "run-1", agentId: "agent-1" }]);
    getAgentById.mockReturnValue({
      id: "agent-1",
      name: "Claude",
      toolPolicy: { Read: "ask" },
    });

    const { default: agentMcpService } = await import("../agentMcpService");

    agentMcpService.registerAgentdPermission({
      runId: "run-1",
      taskId: "task-1",
      requestId: "perm-1",
      agentdRunId: "agentd-run-1",
      toolName: "Bash",
      input: { command: "npm test" },
    });

    agentMcpService.respondToPermission("perm-1", "always");

    await vi.waitFor(() => {
      expect(saveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agent-1",
          toolPolicy: { Read: "ask", Bash: "allow" },
        }),
      );
    });
  });
});
