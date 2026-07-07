import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** Captures event listeners by channel so tests can inject agentd events. */
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((channel: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(channel, handler);
    return Promise.resolve(() => listeners.delete(channel));
  }),
}));

vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

import { FEATURE_FLAGS } from "../../../constants";
import { agentRunService } from "../agentRunService";
import type { AgentProfile, Task } from "../../../../types";

const codexAgent: AgentProfile = {
  id: "agent-codex",
  name: "Codex",
  provider: "codex",
  workingDir: "/tmp/repo",
  permissionMode: "acceptEdits",
  sandbox: "host",
  autoPickup: true,
  runsOnRecurrence: false,
  devCouncilVerify: false,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

const task: Task = {
  id: "task-1",
  title: "Ship the widget",
  description: "",
  status: "InProgress",
  priority: "Medium",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  projectId: "p1",
} as Task;

function emitAgentd(payload: Record<string, unknown>) {
  const handler = listeners.get("agentd-run-event");
  expect(handler).toBeDefined();
  handler!({ payload });
}

describe("agentRunService agentd routing", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("starts non-claude providers through agentd and maps streamed events", async () => {
    expect(FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED).toBe(true);

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "agent_runs_reattach") return Promise.resolve([]);
      if (cmd === "agentd_run_start") return Promise.resolve("sidecar-run-1");
      return Promise.resolve(undefined);
    });

    await agentRunService.initialize();
    const run = await agentRunService.assign(task, codexAgent);
    expect(run).not.toBeNull();

    // Dispatched through the sidecar bridge, not the legacy runner.
    const startCall = invokeMock.mock.calls.find((c) => c[0] === "agentd_run_start");
    expect(startCall).toBeDefined();
    expect(startCall![1]).toMatchObject({ taskId: "task-1", runtime: "codex" });
    expect(invokeMock.mock.calls.some((c) => c[0] === "agent_run_start")).toBe(false);

    expect(run!.engine).toBe("agentd");
    expect(run!.agentdRunId).toBe("sidecar-run-1");
    expect(run!.status).toBe("running");

    // Streamed events are keyed by the SIDECAR id and mapped into the legacy
    // event vocabulary.
    emitAgentd({ runId: "sidecar-run-1", kind: "message", text: "working on it" });
    emitAgentd({ runId: "sidecar-run-1", kind: "tool_use", tool: "bash", input: { cmd: "ls" } });
    emitAgentd({
      runId: "sidecar-run-1",
      kind: "result",
      status: "completed",
      text: "done",
      sessionId: "sess-9",
    });

    const finished = agentRunService.getRuns().find((r) => r.id === run!.id)!;
    expect(finished.status).toBe("completed");
    expect(finished.summary).toBe("done");
    expect(finished.sessionId).toBe("sess-9");
    expect(finished.events.some((e) => e.kind === "assistant" && e.text === "working on it")).toBe(
      true,
    );
    expect(finished.events.some((e) => e.kind === "tool" && e.text.startsWith("bash("))).toBe(true);
  });

  it("routes cancel through the sidecar for agentd runs", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "agent_runs_reattach") return Promise.resolve([]);
      if (cmd === "agentd_run_start") return Promise.resolve("sidecar-run-2");
      return Promise.resolve(undefined);
    });

    const run = await agentRunService.assign({ ...task, id: "task-2" }, {
      ...codexAgent,
      id: "agent-codex-2",
    });
    expect(run?.agentdRunId).toBe("sidecar-run-2");

    invokeMock.mockClear();
    await agentRunService.cancel(run!.id);
    expect(invokeMock.mock.calls.some((c) => c[0] === "agentd_run_cancel")).toBe(true);
    expect(invokeMock.mock.calls.some((c) => c[0] === "agent_run_cancel")).toBe(false);
    expect(agentRunService.getRuns().find((r) => r.id === run!.id)!.status).toBe("cancelled");
  });

  // The DevCouncil probe is cached per workingDir on the singleton service, so
  // each test below uses a distinct workingDir to control its own probe result.
  it("injects the board bridge AND DevCouncil MCP config when .devcouncil exists", async () => {
    invokeMock.mockClear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "agent_runs_reattach") return Promise.resolve([]);
      if (cmd === "agentd_run_start") return Promise.resolve("sidecar-run-3");
      if (cmd === "workspace_read_file") return Promise.resolve("version: 1");
      if (cmd === "agent_mcp_init") return Promise.resolve("/tmp/liquitask-mcp/run-3");
      if (cmd === "agent_mcp_resolve_bridge")
        return Promise.resolve("/app/scripts/liquitask-mcp-bridge.mjs");
      if (cmd === "agent_mcp_list_requests") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const run = await agentRunService.assign(
      { ...task, id: "task-3" },
      { ...codexAgent, id: "agent-codex-3", workingDir: "/tmp/devcouncil-repo" },
    );
    expect(run?.status).toBe("running");

    // The probe reuses the existing workspace_read_file command against the
    // same file AgentSettings' preflight checks.
    const probe = invokeMock.mock.calls.find((c) => c[0] === "workspace_read_file");
    expect(probe?.[1]).toMatchObject({
      filePath: "/tmp/devcouncil-repo/.devcouncil/config.yaml",
      scopePaths: ["/tmp/devcouncil-repo"],
    });

    // mcpConfig is a JSON *string* the sidecar renders into each runtime's
    // native MCP format. Every run gets the LiquiTask board bridge (this is
    // how agents move the card from in-progress to completed); DevCouncil's
    // server rides along when the dir is initialised (no --project-root flag
    // — the server reads DEVCOUNCIL_PROJECT_ROOT).
    const startCall = invokeMock.mock.calls.find((c) => c[0] === "agentd_run_start")!;
    const mcpConfig = (startCall[1] as { mcpConfig?: string }).mcpConfig;
    expect(mcpConfig).toBeDefined();
    const parsed = JSON.parse(mcpConfig!);
    expect(parsed.mcpServers.devcouncil).toEqual({
      command: "devcouncil",
      args: ["mcp-server"],
      env: { DEVCOUNCIL_PROJECT_ROOT: "/tmp/devcouncil-repo" },
    });
    expect(parsed.mcpServers.liquitask).toMatchObject({
      command: "node",
      args: ["/app/scripts/liquitask-mcp-bridge.mjs"],
      env: {
        LIQUITASK_MCP_DIR: "/tmp/liquitask-mcp/run-3",
        LIQUITASK_TASK_ID: "task-3",
        LIQUITASK_RUN_ID: run!.id,
      },
    });
  });

  it("still injects the board bridge (without devcouncil) for plain dirs and caches the probe", async () => {
    invokeMock.mockClear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "agent_runs_reattach") return Promise.resolve([]);
      if (cmd === "agentd_run_start") return Promise.resolve(`sidecar-run-${Math.random()}`);
      if (cmd === "workspace_read_file") {
        return Promise.reject(new Error("Unauthorized access to file"));
      }
      if (cmd === "agent_mcp_init") return Promise.resolve("/tmp/liquitask-mcp/run-4");
      if (cmd === "agent_mcp_resolve_bridge")
        return Promise.resolve("/app/scripts/liquitask-mcp-bridge.mjs");
      if (cmd === "agent_mcp_list_requests") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const run = await agentRunService.assign(
      { ...task, id: "task-4" },
      { ...codexAgent, id: "agent-codex-4", workingDir: "/tmp/plain-repo" },
    );
    expect(run?.status).toBe("running");
    const startCall = invokeMock.mock.calls.find((c) => c[0] === "agentd_run_start")!;
    const mcpConfig = (startCall[1] as { mcpConfig?: string }).mcpConfig;
    expect(mcpConfig).toBeDefined();
    const parsed = JSON.parse(mcpConfig!);
    expect(parsed.mcpServers.devcouncil).toBeUndefined();
    expect(parsed.mcpServers.liquitask).toBeDefined();

    // A second run in the same dir must not re-probe the disk.
    await agentRunService.assign(
      { ...task, id: "task-5" },
      { ...codexAgent, id: "agent-codex-5", workingDir: "/tmp/plain-repo" },
    );
    const probes = invokeMock.mock.calls.filter((c) => c[0] === "workspace_read_file");
    expect(probes).toHaveLength(1);
  });
});
