import { describe, expect, it } from "vitest";

import type { AgentProfile, AgentRun, Task } from "../../../../types";
import {
  checkAgentBudget,
  DEFAULT_HAIKU_MODEL,
  DEFAULT_OPUS_MODEL,
  DEFAULT_SONNET_MODEL,
  getAgentDailyStats,
  resolveAgentModel,
  startOfLocalDay,
} from "../agentPolicyService";

const agent = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: "agent-1",
  name: "Claude",
  provider: "claude-code",
  workingDir: "/repo",
  permissionMode: "acceptEdits",
  sandbox: "host",
  autoPickup: false,
  runsOnRecurrence: true,
  devCouncilVerify: false,
  createdAt: new Date(),
  ...overrides,
});

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Fix bug",
    priority: "medium",
    timeEstimate: 60,
    ...overrides,
  }) as Task;

const run = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: "run-1",
  taskId: "task-1",
  agentId: "agent-1",
  status: "completed",
  createdAt: new Date(),
  startedAt: new Date(),
  costUsd: 1.5,
  events: [],
  ...overrides,
});

describe("agentPolicyService", () => {
  describe("resolveAgentModel", () => {
    it("uses profile model when routing is fixed", () => {
      expect(
        resolveAgentModel(agent({ model: "claude-custom", modelRouting: "fixed" }), task()),
      ).toBe("claude-custom");
    });

    it("routes low priority with short estimate to haiku", () => {
      expect(
        resolveAgentModel(
          agent({ modelRouting: "auto" }),
          task({ priority: "low", timeEstimate: 15 }),
        ),
      ).toBe(DEFAULT_HAIKU_MODEL);
    });

    it("routes high priority to opus", () => {
      expect(resolveAgentModel(agent({ modelRouting: "auto" }), task({ priority: "high" }))).toBe(
        DEFAULT_OPUS_MODEL,
      );
    });

    it("routes medium priority with short estimate to sonnet", () => {
      expect(
        resolveAgentModel(
          agent({ modelRouting: "auto" }),
          task({ priority: "medium", timeEstimate: 45 }),
        ),
      ).toBe(DEFAULT_SONNET_MODEL);
    });

    it("routes large estimates to opus even when priority is low", () => {
      expect(
        resolveAgentModel(
          agent({ modelRouting: "auto" }),
          task({ priority: "low", timeEstimate: 240 }),
        ),
      ).toBe(DEFAULT_OPUS_MODEL);
    });
  });

  describe("getAgentDailyStats", () => {
    it("counts runs started today and sums their cost", () => {
      const today = startOfLocalDay(new Date());
      const yesterday = new Date(today.getTime() - 86_400_000);
      const stats = getAgentDailyStats("agent-1", [
        run({ id: "r1", startedAt: today, costUsd: 2 }),
        run({ id: "r2", startedAt: today, costUsd: 0.5 }),
        run({ id: "r3", startedAt: yesterday, costUsd: 99 }),
        run({ id: "r4", agentId: "other", startedAt: today, costUsd: 5 }),
      ]);
      expect(stats.runCount).toBe(2);
      expect(stats.spendUsd).toBe(2.5);
    });
  });

  describe("checkAgentBudget", () => {
    it("allows when under caps", () => {
      expect(
        checkAgentBudget(agent({ dailyCostCapUsd: 10, maxRunsPerDay: 5 }), {
          runCount: 2,
          spendUsd: 3,
        }),
      ).toBeNull();
    });

    it("blocks when cost cap exceeded", () => {
      const msg = checkAgentBudget(agent({ dailyCostCapUsd: 5 }), {
        runCount: 1,
        spendUsd: 5,
      });
      expect(msg).toContain("Daily cost cap");
    });

    it("blocks when max runs reached", () => {
      const msg = checkAgentBudget(agent({ maxRunsPerDay: 3 }), {
        runCount: 3,
        spendUsd: 0,
      });
      expect(msg).toContain("Max runs per day");
    });

    it("treats zero caps as unlimited", () => {
      expect(
        checkAgentBudget(agent({ dailyCostCapUsd: 0, maxRunsPerDay: 0 }), {
          runCount: 100,
          spendUsd: 100,
        }),
      ).toBeNull();
    });
  });
});
