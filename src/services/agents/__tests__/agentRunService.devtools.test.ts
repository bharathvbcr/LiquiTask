import { afterEach, describe, expect, it, vi } from "vitest";

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
}));
vi.mock("../../storageService", () => ({
  __esModule: true,
  default: { get: vi.fn(() => []), set: vi.fn() },
}));

import { agentRunService } from "../agentRunService";

describe("agentRunService dev-tools bridge", () => {
  afterEach(() => {
    invokeMock.mockReset();
  });

  it("detectIdeTools invokes the agent_detect_ide_tools command", async () => {
    invokeMock.mockResolvedValue([
      { id: "vscode", name: "Visual Studio Code", binary: "code", available: true, kind: "ide" },
    ]);
    const tools = await agentRunService.detectIdeTools();
    expect(invokeMock).toHaveBeenCalledWith("agent_detect_ide_tools");
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("vscode");
    expect(tools[0].kind).toBe("ide");
  });

  it("openInTool maps params to agent_open_in_tool (app mode)", async () => {
    invokeMock.mockResolvedValue(undefined);
    await agentRunService.openInTool("code", "/tmp/repo", "app");
    expect(invokeMock).toHaveBeenCalledWith("agent_open_in_tool", {
      tool: "code",
      workingDir: "/tmp/repo",
      mode: "app",
    });
  });

  it("openInTool maps params to agent_open_in_tool (bundle mode)", async () => {
    invokeMock.mockResolvedValue(undefined);
    await agentRunService.openInTool("Cursor", "/work/liquitask", "bundle");
    expect(invokeMock).toHaveBeenCalledWith("agent_open_in_tool", {
      tool: "Cursor",
      workingDir: "/work/liquitask",
      mode: "bundle",
    });
  });

  it("openInTool maps params to agent_open_in_tool (terminal mode)", async () => {
    invokeMock.mockResolvedValue(undefined);
    await agentRunService.openInTool("claude", "/work/liquitask", "terminal");
    expect(invokeMock).toHaveBeenCalledWith("agent_open_in_tool", {
      tool: "claude",
      workingDir: "/work/liquitask",
      mode: "terminal",
    });
  });

  it("openInTool surfaces backend errors to the caller", async () => {
    invokeMock.mockRejectedValue(new Error("Working directory is not an authorised workspace path"));
    await expect(agentRunService.openInTool("code", "/nope", "app")).rejects.toThrow(
      /authorised workspace path/,
    );
  });
});
