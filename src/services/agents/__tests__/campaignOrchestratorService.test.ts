import { describe, expect, it, vi } from "vitest";

import { CampaignMailbox } from "../campaignMailbox";
import campaignOrchestratorService, {
  type CampaignPlanner,
  type CampaignRunner,
} from "../campaignOrchestratorService";
import type { DevCouncilSubtask } from "../../nativeBridge";
import type { AgentProfile, BoardColumn, Task } from "../../../../types";

const columns: BoardColumn[] = [{ id: "col-backlog", title: "Backlog", order: 0, isCompleted: false }];

const epic: Task = {
  id: "epic-1",
  jobId: "TSK-100",
  projectId: "proj-1",
  title: "Ship settings page",
  summary: "Settings + persistence",
  assignee: "",
  priority: "high",
  status: "col-backlog",
  createdAt: new Date(),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 0,
  timeSpent: 0,
};

const worker = (id: string, name: string): AgentProfile => ({
  id,
  name,
  provider: "claude-code",
  workingDir: "/repo",
  permissionMode: "acceptEdits",
  sandbox: "host",
  autoPickup: false,
  runsOnRecurrence: false,
  devCouncilVerify: true,
  createdAt: new Date(),
});

const planner = (id: string, name: string): AgentProfile => ({ ...worker(id, name), role: "planner" });

const agents: AgentProfile[] = [worker("a1", "Worker-1"), worker("a2", "Worker-2"), planner("g1", "Reviewer")];

const subtask = (id: string, title: string, dependsOn: string[] = []): DevCouncilSubtask => ({
  id,
  title,
  description: title,
  priority: "medium",
  dependsOn,
});

const fakePlanner = (subtasks: DevCouncilSubtask[]): CampaignPlanner => ({
  async decompose() {
    return subtasks;
  },
});

interface Call {
  title: string;
  agent: string;
}

const fakeRunner = (opts: { fail?: string[]; block?: string[]; calls?: Call[] } = {}): CampaignRunner => {
  const fail = new Set(opts.fail ?? []);
  const block = new Set(opts.block ?? []);
  return {
    async run(task, agent) {
      opts.calls?.push({ title: task.title, agent: agent.name });
      if (fail.has(task.title)) return { ok: false, verified: false, blockingGaps: ["exec failed"] };
      if (block.has(task.title)) return { ok: true, verified: false, blockingGaps: ["gate failed"] };
      return { ok: true, verified: true, blockingGaps: [], summary: "done" };
    },
  };
};

describe("CampaignOrchestratorService", () => {
  it("decomposes, dispatches in parallel, verifies, and writes a dashboard", async () => {
    const onCreateTasks = vi.fn();
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([subtask("S1", "Implement A"), subtask("S2", "Implement B"), subtask("S3", "Fix C")]),
      runner: fakeRunner(),
      mailbox: new CampaignMailbox(),
      onCreateTasks,
    });

    expect(result.verified.sort()).toEqual(["S1", "S2", "S3"]);
    expect(result.success).toBe(true);
    expect(onCreateTasks).toHaveBeenCalledTimes(1);
    expect(onCreateTasks.mock.calls[0][0]).toHaveLength(3);
    expect(result.dashboardMarkdown).toContain("Achievements");
  });

  it("respects dependencies across waves", async () => {
    const calls: Call[] = [];
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([
        subtask("S3", "Implement C", ["S2"]),
        subtask("S1", "Implement A"),
        subtask("S2", "Implement B", ["S1"]),
      ]),
      runner: fakeRunner({ calls }),
      mailbox: new CampaignMailbox(),
    });
    const order = calls.map((c) => c.title);
    expect(order.indexOf("Implement A")).toBeLessThan(order.indexOf("Implement B"));
    expect(order.indexOf("Implement B")).toBeLessThan(order.indexOf("Implement C"));
    expect(result.verified).toHaveLength(3);
  });

  it("skips dependents when a prerequisite is blocked", async () => {
    const calls: Call[] = [];
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([subtask("S1", "Implement A"), subtask("S2", "Implement B", ["S1"])]),
      runner: fakeRunner({ block: ["Implement A"], calls }),
      mailbox: new CampaignMailbox(),
    });
    expect(result.blocked).toEqual(["S1"]);
    expect(result.skipped).toEqual(["S2"]);
    expect(calls.some((c) => c.title === "Implement B")).toBe(false);
    expect(result.success).toBe(false);
  });

  it("marks an execution failure as failed", async () => {
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([subtask("S1", "Implement A")]),
      runner: fakeRunner({ fail: ["Implement A"] }),
      mailbox: new CampaignMailbox(),
    });
    expect(result.outcomes[0].status).toBe("failed");
  });

  it("routes a cognition task to the Reviewer agent", async () => {
    const calls: Call[] = [];
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([subtask("S1", "Design the storage architecture")]),
      runner: fakeRunner({ calls }),
      mailbox: new CampaignMailbox(),
    });
    expect(result.outcomes[0].owner).toBe("reviewer");
    expect(result.outcomes[0].bloom).toBe("Create");
    expect(calls[0].agent).toBe("Reviewer");
  });

  it("routes mailbox traffic along the chain of command", async () => {
    const mailbox = new CampaignMailbox();
    await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([subtask("S1", "Implement A")]),
      runner: fakeRunner(),
      mailbox,
    });
    const leadTypes = new Set(mailbox.all("lead").map((m) => m.type));
    expect(leadTypes.has("cmd_new")).toBe(true); // Commander -> Lead
    expect(leadTypes.has("qc_result")).toBe(true); // Reviewer -> Lead
    expect(mailbox.all("reviewer").some((m) => m.type === "report_received")).toBe(true);
    expect(mailbox.all("worker1").some((m) => m.type === "task_assigned")).toBe(true);
  });

  it("stands down remaining tasks when cancelled mid-campaign", async () => {
    // Sequential chain so cancelling during S1 skips S2 and S3.
    const runner: CampaignRunner = {
      async run(task) {
        if (task.title === "Implement A") campaignOrchestratorService.cancelCampaign();
        return { ok: true, verified: true, blockingGaps: [] };
      },
    };
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([
        subtask("S1", "Implement A"),
        subtask("S2", "Implement B", ["S1"]),
        subtask("S3", "Implement C", ["S2"]),
      ]),
      runner,
      mailbox: new CampaignMailbox(),
    });
    expect(result.verified).toEqual(["S1"]);
    expect(result.skipped.sort()).toEqual(["S2", "S3"]);
    const stoodDown = result.outcomes.filter((o) => o.status === "skipped");
    expect(stoodDown.every((o) => o.blockingGaps.some((g) => /stood down/i.test(g)))).toBe(true);
  });

  it("falls back to a single subtask when no plan is produced", async () => {
    const result = await campaignOrchestratorService.startCampaign({
      epic,
      agents,
      columns,
      planner: fakePlanner([]),
      runner: fakeRunner(),
      mailbox: new CampaignMailbox(),
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].title).toBe(epic.title);
  });
});
