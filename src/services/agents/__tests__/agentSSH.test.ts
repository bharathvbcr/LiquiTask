import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../../../types";

function agentdSSHStartParams(agent: AgentProfile): {
  host?: "local" | "ssh";
  ssh?: AgentProfile["ssh"];
  localBasePath?: string;
} {
  if ((agent.host ?? "local") !== "ssh" || !agent.ssh?.target?.trim()) {
    return {};
  }
  return {
    host: "ssh",
    ssh: agent.ssh,
    localBasePath: agent.workingDir,
  };
}

describe("agentdSSHStartParams", () => {
  it("returns empty params for local agents", () => {
    expect(
      agentdSSHStartParams({
        host: "local",
        workingDir: "/repo",
      } as AgentProfile),
    ).toEqual({});
  });

  it("forwards ssh config when host is ssh", () => {
    expect(
      agentdSSHStartParams({
        host: "ssh",
        workingDir: "/Users/dev/project",
        ssh: { target: "dev@box", remotePath: "/home/dev/project" },
      } as AgentProfile),
    ).toEqual({
      host: "ssh",
      ssh: { target: "dev@box", remotePath: "/home/dev/project" },
      localBasePath: "/Users/dev/project",
    });
  });

  it("ignores ssh host without a target", () => {
    expect(
      agentdSSHStartParams({
        host: "ssh",
        workingDir: "/repo",
        ssh: { target: "  " },
      } as AgentProfile),
    ).toEqual({});
  });
});
