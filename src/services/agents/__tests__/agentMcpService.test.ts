import { describe, expect, it } from "vitest";

import {
  buildPermissionResponse,
  describePermissionInput,
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
