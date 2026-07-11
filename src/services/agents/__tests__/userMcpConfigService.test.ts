import { beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEYS } from "../../../constants";

describe("userMcpConfigService", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("normalizes and persists stdio servers", async () => {
    const { default: service } = await import("../userMcpConfigService");
    service.saveUserMcpServers([
      {
        id: "s1",
        name: "my-tool",
        transport: "stdio",
        command: "npx",
        args: ["-y", "some-mcp"],
        enabled: true,
      },
    ]);
    const servers = service.getUserMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].command).toBe("npx");
    expect(servers[0].args).toEqual(["-y", "some-mcp"]);
  });

  it("rejects invalid server names on read", async () => {
    localStorage.setItem(
      STORAGE_KEYS.USER_MCP_SERVERS,
      JSON.stringify([
        { id: "bad", name: "123invalid", transport: "stdio", command: "x", enabled: true },
      ]),
    );
    const { default: service } = await import("../userMcpConfigService");
    expect(service.getUserMcpServers()).toEqual([]);
  });

  it("builds http transport entries", async () => {
    const { userMcpServerToConfigEntry } = await import("../userMcpConfigService");
    expect(
      userMcpServerToConfigEntry({
        id: "h1",
        name: "remote",
        transport: "http",
        url: "http://127.0.0.1:3000/mcp",
        enabled: true,
      }),
    ).toEqual({ url: "http://127.0.0.1:3000/mcp" });
  });
});
