import { describe, expect, it } from "vitest";
import { deriveSquadPresence, deriveSquads, suggestSquadRanks } from "../deriveSquads";
import type { AgentProfile, AgentRun } from "../../../../types";

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-1",
    name: "Codey",
    provider: "claude-code",
    workingDir: "/repo/app",
    permissionMode: "default",
    sandbox: "host",
    autoPickup: true,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  } as AgentProfile;
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "completed",
    createdAt: new Date("2026-07-05T00:00:00Z"),
    events: [],
    ...overrides,
  } as AgentRun;
}

describe("deriveSquads", () => {
  it("returns empty for empty inputs", () => {
    expect(deriveSquads([], [])).toEqual([]);
  });

  it("groups agents sharing a workingDir; a lone agent is not a squad", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Zed", workingDir: "/repo/app" }),
      makeAgent({ id: "a2", name: "Amp", workingDir: "/repo/app/" }), // trailing slash normalized
      makeAgent({ id: "a3", name: "Solo", workingDir: "/repo/other" }),
    ];

    const squads = deriveSquads(agents, []);
    expect(squads).toHaveLength(1);
    expect(squads[0]).toMatchObject({
      id: "squad:/repo/app",
      name: "app",
      memberAgentIds: ["a2", "a1"], // name-sorted: Amp, Zed
      activeRunCount: 0,
    });
    expect(squads[0].lastActivityAt).toBeUndefined();
  });

  it("counts active member runs and tracks the latest activity", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Zed" }),
      makeAgent({ id: "a2", name: "Amp" }),
      makeAgent({ id: "a3", name: "Outsider", workingDir: "/repo/other" }),
    ];
    const runs = [
      makeRun({ id: "r1", agentId: "a1", status: "running", startedAt: new Date("2026-07-06T10:00:00Z") }),
      makeRun({ id: "r2", agentId: "a2", status: "queued", createdAt: new Date("2026-07-06T09:00:00Z") }),
      makeRun({ id: "r3", agentId: "a1", status: "completed", finishedAt: new Date("2026-07-06T12:00:00Z") }),
      // Outsider's run must not leak into the squad.
      makeRun({ id: "r4", agentId: "a3", status: "running", startedAt: new Date("2026-07-06T13:00:00Z") }),
    ];

    const [squad] = deriveSquads(agents, runs);
    expect(squad.activeRunCount).toBe(2);
    expect(squad.lastActivityAt).toEqual(new Date("2026-07-06T12:00:00Z"));
  });

  it("sorts squads by name", () => {
    const agents = [
      makeAgent({ id: "a1", name: "A", workingDir: "/x/zeta" }),
      makeAgent({ id: "a2", name: "B", workingDir: "/x/zeta" }),
      makeAgent({ id: "a3", name: "C", workingDir: "/x/alpha" }),
      makeAgent({ id: "a4", name: "D", workingDir: "/x/alpha" }),
    ];
    expect(deriveSquads(agents, []).map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("deriveSquadPresence", () => {
  const squad = {
    id: "squad:/repo/app",
    name: "app",
    memberAgentIds: ["a1", "a2"],
    activeRunCount: 0,
  };

  it("is idle with no member runs", () => {
    const runs = [makeRun({ agentId: "outsider", status: "running" })];
    expect(deriveSquadPresence(squad, runs)).toBe("idle");
  });

  it("is working while a member run is active", () => {
    const runs = [makeRun({ agentId: "a1", status: "running" })];
    expect(deriveSquadPresence(squad, runs)).toBe("working");
  });

  it("is blocked when any member run is blocked, even if others are working", () => {
    const runs = [
      makeRun({ id: "r1", agentId: "a1", status: "running" }),
      makeRun({ id: "r2", agentId: "a2", status: "running", isPaused: true }),
    ];
    expect(deriveSquadPresence(squad, runs)).toBe("blocked");
  });

  it("treats permission failures as blocked (shared isBlockedRun semantics)", () => {
    const runs = [makeRun({ agentId: "a1", status: "failed", error: "Permission denied" })];
    expect(deriveSquadPresence(squad, runs)).toBe("blocked");
  });
});

describe("suggestSquadRanks", () => {
  it("maps lead, reviewer, then workers in roster order", () => {
    expect(suggestSquadRanks(["a1", "a2", "a3", "a4"]).map((r) => r.rank)).toEqual([
      "lead",
      "reviewer",
      "worker",
      "worker",
    ]);
  });

  it("carries campaign role titles from campaignRoles", () => {
    const [lead] = suggestSquadRanks(["a1"]);
    expect(lead.title).toBe("Lead");
  });

  it("returns empty for an empty roster", () => {
    expect(suggestSquadRanks([])).toEqual([]);
  });
});
