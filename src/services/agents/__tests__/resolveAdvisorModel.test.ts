import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../../../types";
import { resolveAdvisorModel } from "../agentRunService";

function agent(partial: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "a1",
    name: "Claude",
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: false,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    createdAt: new Date(),
    ...partial,
  } as AgentProfile;
}

describe("resolveAdvisorModel", () => {
  it("returns trimmed advisor for Claude Code workers", () => {
    expect(resolveAdvisorModel(agent({ advisorModel: "  opus  " }))).toBe("opus");
  });

  it("returns undefined when unset", () => {
    expect(resolveAdvisorModel(agent())).toBeUndefined();
    expect(resolveAdvisorModel(agent({ advisorModel: "   " }))).toBeUndefined();
  });

  it("ignores advisor for planner role", () => {
    expect(
      resolveAdvisorModel(agent({ role: "planner", advisorModel: "opus" })),
    ).toBeUndefined();
  });

  it("ignores advisor for non-Claude providers", () => {
    expect(
      resolveAdvisorModel(agent({ provider: "codex", advisorModel: "opus" })),
    ).toBeUndefined();
  });
});
