import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../../types";
import { shouldRunAgentOnRecurrence } from "../agentRecurrence";

const baseAgent = (): AgentProfile => ({
  id: "agent-1",
  name: "Worker",
  provider: "claude-code",
  workingDir: "/repo",
  permissionMode: "acceptEdits",
  sandbox: "host",
  autoPickup: false,
  runsOnRecurrence: true,
  devCouncilVerify: false,
  createdAt: new Date(),
});

describe("shouldRunAgentOnRecurrence", () => {
  it("returns true when runsOnRecurrence is enabled", () => {
    expect(shouldRunAgentOnRecurrence(baseAgent())).toBe(true);
  });

  it("returns false when runsOnRecurrence is disabled", () => {
    expect(shouldRunAgentOnRecurrence({ ...baseAgent(), runsOnRecurrence: false })).toBe(false);
  });

  it("defaults to true when runsOnRecurrence is unset (legacy profiles)", () => {
    const { runsOnRecurrence: _, ...legacy } = baseAgent();
    expect(shouldRunAgentOnRecurrence(legacy as AgentProfile)).toBe(true);
  });
});
