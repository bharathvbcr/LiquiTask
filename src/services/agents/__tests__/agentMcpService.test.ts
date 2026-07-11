import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  buildPermissionResponse,
  describePermissionInput,
  extractFilePath,
  isMutatingToolCall,
  isShellTool,
} from "../agentMcpService";

describe("buildPermissionResponse", () => {
  it("returns allow payload with updatedInput", () => {
    const input = { command: "npm test" };
    const response = buildPermissionResponse(true, input);
    const text = (response.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("returns deny payload when not approved", () => {
    const response = buildPermissionResponse(false, { command: "rm -rf /" });
    const text = (response.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ behavior: "deny" });
  });
});

describe("describePermissionInput", () => {
  it("summarizes bash commands", () => {
    const { summary, detail } = describePermissionInput("Bash", { command: "cargo test" });
    expect(summary).toBe("cargo test");
    expect(detail).toBe("cargo test");
  });

  it("summarizes file edits with path", () => {
    const { summary } = describePermissionInput("Write", { file_path: "/tmp/foo.rs" });
    expect(summary).toBe("Write: /tmp/foo.rs");
  });

  it("falls back to tool name for unknown shapes", () => {
    const { summary } = describePermissionInput("CustomTool", null);
    expect(summary).toBe("CustomTool action");
  });
});

// Note: `processPermissionPrompt` (the actual scope-enforcement call site) is
// a private method only reachable via the file-based MCP polling loop, which
// requires a live `isTauri()` native-bridge invoke round-trip. This test file
// only exercises the pure, exported helpers it relies on — there's no natural
// extension point here without adding tauri/invoke mocking infrastructure
// this suite doesn't currently have. See agentScopeService.test.ts for
// coverage of the actual scope-check logic those helpers feed into.
describe("extractFilePath", () => {
  it("reads file_path from tool input", () => {
    expect(extractFilePath({ file_path: "src/foo.ts" })).toBe("src/foo.ts");
  });

  it("reads camelCase filePath from tool input", () => {
    expect(extractFilePath({ filePath: "src/foo.ts" })).toBe("src/foo.ts");
  });

  it("returns undefined when no path is present", () => {
    expect(extractFilePath({ command: "ls" })).toBeUndefined();
    expect(extractFilePath(null)).toBeUndefined();
  });
});

describe("isMutatingToolCall", () => {
  it("treats any tool call with a file path as mutating (false-negatives are unsafe here)", () => {
    expect(isMutatingToolCall("Read", "src/foo.ts")).toBe(true);
  });

  it("matches write/edit/delete tool names even without a resolved path", () => {
    expect(isMutatingToolCall("Write", undefined)).toBe(true);
    expect(isMutatingToolCall("Edit", undefined)).toBe(true);
    expect(isMutatingToolCall("mcp__fs__delete_file", undefined)).toBe(true);
    expect(isMutatingToolCall("EDIT", undefined)).toBe(true);
  });

  it("treats bash and shell commands as mutating even without a file path", () => {
    expect(isMutatingToolCall("Bash", undefined)).toBe(true);
    expect(isMutatingToolCall("Run", undefined, { command: "npm test" })).toBe(true);
  });
});

describe("isShellTool", () => {
  it("detects bash tools and command payloads", () => {
    expect(isShellTool("Bash", { command: "ls" })).toBe(true);
    expect(isShellTool("Run", { cmd: "npm test" })).toBe(true);
    expect(isShellTool("Write", { file_path: "src/foo.ts" })).toBe(false);
  });
});

describe("prepareMcpConfig", () => {
  const setup = async (devCliAvailable: boolean) => {
    vi.resetModules();
    vi.doMock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

    const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "agent_mcp_init":
          return { mcpDir: "/tmp/mcp-dir" };
        case "agent_mcp_resolve_bridge":
          return "/app/scripts/liquitask-mcp-bridge.mjs";
        case "agent_mcp_write_config":
          return `${(args as { mcpDir: string }).mcpDir}/mcp-config.json`;
        default:
          return undefined;
      }
    });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
    vi.doMock("../../nativeBridge", () => ({
      nativeDevCliAvailable: vi.fn().mockResolvedValue(devCliAvailable),
    }));

    const { default: service } = await import("../agentMcpService");
    return { service, invokeMock };
  };

  const writtenConfig = (invokeMock: Mock) => {
    const call = invokeMock.mock.calls.find(([cmd]) => cmd === "agent_mcp_write_config");
    const configJson = (call?.[1] as { configJson: string }).configJson;
    return JSON.parse(configJson) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("always registers the liquitask MCP server entry", async () => {
    const { service, invokeMock } = await setup(false);
    await service.prepareMcpConfig("run-1", "task-1", "/repo");
    const config = writtenConfig(invokeMock);

    expect(config.mcpServers.liquitask).toEqual({
      command: "node",
      args: ["/app/scripts/liquitask-mcp-bridge.mjs"],
      env: {
        LIQUITASK_MCP_DIR: "/tmp/mcp-dir",
        LIQUITASK_TASK_ID: "task-1",
        LIQUITASK_RUN_ID: "run-1",
      },
    });
  });

  it("registers the devcouncil MCP server entry when the CLI is available and workingDir is known", async () => {
    const { service, invokeMock } = await setup(true);
    await service.prepareMcpConfig("run-1", "task-1", "/repo");
    const config = writtenConfig(invokeMock);

    expect(config.mcpServers.devcouncil).toEqual({
      command: "devcouncil",
      args: ["mcp-server"],
      env: { DEVCOUNCIL_PROJECT_ROOT: "/repo" },
    });
  });

  it("omits the devcouncil MCP server entry when the CLI is unavailable", async () => {
    const { service, invokeMock } = await setup(false);
    await service.prepareMcpConfig("run-1", "task-1", "/repo");
    const config = writtenConfig(invokeMock);

    expect(config.mcpServers.devcouncil).toBeUndefined();
  });

  it("omits the devcouncil MCP server entry when no workingDir is provided", async () => {
    const { service, invokeMock } = await setup(true);
    await service.prepareMcpConfig("run-1", "task-1");
    const config = writtenConfig(invokeMock);

    expect(config.mcpServers.devcouncil).toBeUndefined();
  });

  it("caches the CLI availability probe across multiple prepareMcpConfig calls", async () => {
    const { service } = await setup(true);
    const nativeBridge = await import("../../nativeBridge");

    await service.prepareMcpConfig("run-1", "task-1", "/repo");
    await service.prepareMcpConfig("run-2", "task-2", "/repo");

    expect(nativeBridge.nativeDevCliAvailable).toHaveBeenCalledTimes(1);
  });

  it("merges user-defined MCP servers from settings", async () => {
    vi.resetModules();
    vi.doMock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
    vi.doMock("../userMcpConfigService", () => ({
      default: {
        getEnabledUserMcpServers: () => [
          {
            id: "u1",
            name: "custom",
            transport: "stdio",
            command: "my-mcp",
            args: ["serve"],
            enabled: true,
          },
        ],
        userMcpServerToConfigEntry: (s: { command?: string; args?: string[] }) => ({
          command: s.command,
          args: s.args ?? [],
        }),
      },
    }));

    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === "agent_mcp_init") {
        return { mcpDir: "/tmp/mcp-dir" };
      }
      if (cmd === "agent_mcp_resolve_bridge") return "/app/scripts/liquitask-mcp-bridge.mjs";
      return undefined;
    });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
    vi.doMock("../../nativeBridge", () => ({
      nativeDevCliAvailable: vi.fn().mockResolvedValue(false),
    }));

    const { default: service } = await import("../agentMcpService");
    await service.prepareMcpConfig("run-1", "task-1", "/repo");
    const call = invokeMock.mock.calls.find(([cmd]) => cmd === "agent_mcp_write_config");
    const configJson = (call?.[1] as { configJson: string }).configJson;
    const config = JSON.parse(configJson) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(config.mcpServers.custom).toEqual({ command: "my-mcp", args: ["serve"] });
  });
});
