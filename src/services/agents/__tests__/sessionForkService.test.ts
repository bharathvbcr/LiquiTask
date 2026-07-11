import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile, AgentRun, Task } from "../../../types";
import agentRunService from "../agentRunService";
import agentService from "../agentService";
import {
  createCheckpoint,
  forkSession,
  supportsSessionFork,
} from "../sessionForkService";

vi.mock("../../../core/api/localApi", () => ({
  localApi: {
    sessionsMessageCount: vi.fn(),
    sessionsFork: vi.fn(),
    sessionsTruncate: vi.fn(),
  },
}));

vi.mock("../agentRunService", () => ({
  default: {
    getRuns: vi.fn(),
    addCheckpoint: vi.fn(),
    noteRewind: vi.fn(),
    followUp: vi.fn(),
    adoptExternalSession: vi.fn(),
    persistRun: vi.fn(),
    logInfo: vi.fn(),
  },
}));

vi.mock("../agentService", () => ({
  default: {
    getAgentById: vi.fn(),
  },
}));

import { localApi } from "../../../core/api/localApi";

const claudeAgent: AgentProfile = {
  id: "agent-1",
  name: "Claude",
  provider: "claude-code",
  model: "claude-sonnet-4",
  permissionMode: "default",
  createdAt: new Date(),
};

const cursorAgent: AgentProfile = {
  ...claudeAgent,
  id: "agent-2",
  provider: "cursor",
};

const baseRun: AgentRun = {
  id: "run-1",
  taskId: "task-1",
  agentId: "agent-1",
  status: "completed",
  createdAt: new Date(),
  events: [],
  sessionId: "sess-abc",
  repoDir: "/tmp/repo",
};

const baseTask: Task = {
  id: "task-1",
  jobId: "TSK-1001",
  projectId: "proj-1",
  title: "Fix bug",
  summary: "summary",
  assignee: "Claude",
  priority: "medium",
  status: "col-backlog",
  createdAt: new Date(),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 0,
  timeSpent: 0,
};

describe("supportsSessionFork", () => {
  it("enables Claude and Codex only", () => {
    expect(supportsSessionFork("claude-code")).toBe(true);
    expect(supportsSessionFork("codex")).toBe(true);
    expect(supportsSessionFork("cursor")).toBe(false);
  });
});

describe("createCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentRunService.getRuns).mockReturnValue([baseRun]);
    vi.mocked(agentService.getAgentById).mockReturnValue(claudeAgent);
    vi.mocked(localApi.sessionsMessageCount).mockResolvedValue({ messageIndex: 5, sessionPath: "/x" });
  });

  it("records a checkpoint at the current message index", async () => {
    const checkpoint = await createCheckpoint("run-1", "before refactor");
    expect(checkpoint?.messageIndex).toBe(5);
    expect(agentRunService.addCheckpoint).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ messageIndex: 5, label: "before refactor" }),
    );
  });

  it("rejects unsupported runtimes", async () => {
    vi.mocked(agentService.getAgentById).mockReturnValue(cursorAgent);
    await expect(createCheckpoint("run-1")).rejects.toThrow(/Claude and Codex/);
  });
});

describe("forkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentRunService.getRuns).mockReturnValue([baseRun]);
    vi.mocked(agentService.getAgentById).mockReturnValue(claudeAgent);
    vi.mocked(localApi.sessionsFork).mockResolvedValue({
      newSessionId: "sess-fork",
      sessionPath: "/tmp/sess-fork.jsonl",
      messageIndex: 3,
    });
    vi.mocked(agentRunService.adoptExternalSession).mockReturnValue({
      ...baseRun,
      id: "run-fork",
      taskId: "task-fork",
      sessionId: "sess-fork",
    });
  });

  it("forks to a duplicated task via agentd", async () => {
    const onCreateTask = vi.fn();
    const forked = await forkSession("run-1", { task: baseTask, onCreateTask });
    expect(localApi.sessionsFork).toHaveBeenCalledWith(
      "claude",
      "sess-abc",
      "/tmp/repo",
      undefined,
    );
    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fix bug (fork)" }),
    );
    expect(forked.sessionId).toBe("sess-fork");
    expect(agentRunService.persistRun).toHaveBeenCalled();
  });
});
