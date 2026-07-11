import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../feedbackLoopService", () => ({
  evaluateReviewGate: vi.fn(),
  default: {},
}));

import type { AgentRun } from "../../../../types";
import agentRunService from "../agentRunService";
import { listTrace, recordTraceStep } from "../runTraceService";
import {
  isReviewerAgent,
  shouldUseLocalReviewerStage,
  parseStructuredReviewVerdict,
} from "../reviewerRoleService";

vi.mock("../agentRunService", () => ({
  default: {
    getRuns: vi.fn(() => []),
    persistRun: vi.fn(),
    logInfo: vi.fn(),
  },
}));

describe("runTraceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listTrace returns ordered steps from run.traceSteps", () => {
    const run: AgentRun = {
      id: "run-1",
      taskId: "t1",
      agentId: "a1",
      status: "running",
      createdAt: new Date(),
      events: [],
      traceSteps: [
        {
          id: "s1",
          index: 0,
          kind: "tool",
          label: "Read",
          ts: new Date(),
        },
        {
          id: "s2",
          index: 1,
          kind: "file_write",
          label: "Write src/foo.ts",
          ts: new Date(),
          gitCommitSha: "abc1234",
        },
      ],
    };
    vi.mocked(agentRunService.getRuns).mockReturnValue([run]);
    const trace = listTrace("run-1");
    expect(trace?.steps).toHaveLength(2);
    expect(trace?.steps[1].gitCommitSha).toBe("abc1234");
  });

  it("recordTraceStep appends with monotonic index", () => {
    const run: AgentRun = {
      id: "run-2",
      taskId: "t1",
      agentId: "a1",
      status: "running",
      createdAt: new Date(),
      events: [],
      traceSteps: [],
    };
    vi.mocked(agentRunService.getRuns).mockReturnValue([run]);
    const step = recordTraceStep("run-2", { kind: "permission", label: "Bash allow" });
    expect(step?.index).toBe(0);
    expect(agentRunService.persistRun).toHaveBeenCalled();
  });
});

describe("reviewerRoleService", () => {
  it("isReviewerAgent detects reviewer role", () => {
    expect(isReviewerAgent({ role: "reviewer" } as never)).toBe(true);
    expect(isReviewerAgent({ role: "coder" } as never)).toBe(false);
  });

  it("shouldUseLocalReviewerStage when reviewerAgentGate on merge path", () => {
    expect(
      shouldUseLocalReviewerStage({
        commitStage: "merge",
        reviewerAgentGate: true,
      } as never),
    ).toBe(true);
    expect(
      shouldUseLocalReviewerStage({
        commitStage: "pushPr",
        reviewerAgentGate: true,
      } as never),
    ).toBe(false);
  });

  it("parseStructuredReviewVerdict maps request-changes", () => {
    const v = parseStructuredReviewVerdict({
      verdict: "request-changes",
      passed: false,
      blockingIssues: ["missing tests"],
      summary: "Add coverage",
    });
    expect(v.verdict).toBe("request-changes");
    expect(v.blockingIssues).toEqual(["missing tests"]);
  });
});
