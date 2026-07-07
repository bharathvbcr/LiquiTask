import { describe, expect, it } from "vitest";

import type {
  DevStoredEvidence,
  DevStoredRequirement,
  DevStoredTask,
} from "../../nativeBridge";
import {
  buildTaskEvidenceView,
  devcouncilTaskIdFromTags,
  evidenceLabel,
  type EvidenceGraph,
} from "../devcouncilEvidence";

const graph = (): EvidenceGraph => ({
  requirements: [
    { id: "REQ-001", title: "Dark mode", description: "Add a toggle", priority: "high", source: "user" },
    { id: "REQ-002", title: "CSV export", description: "Export tasks", priority: "medium", source: "planner" },
  ] satisfies DevStoredRequirement[],
  tasks: [
    {
      id: "TASK-001",
      title: "Theme toggle",
      description: "Wire it up",
      status: "in_progress",
      requirementIdsJson: '["REQ-001"]',
      plannedFilesJson: '[{"path":"src/theme.ts"}]',
    },
  ] satisfies DevStoredTask[],
  evidence: [
    { id: 1, kind: "command", taskId: "TASK-001", requirementId: "REQ-001", dataJson: '{"command":"npm test"}' },
    { id: 2, kind: "diff", taskId: "TASK-001", requirementId: "REQ-001", dataJson: '{"file":"src/theme.ts"}' },
    { id: 3, kind: "test", taskId: "TASK-999", requirementId: "REQ-002", dataJson: null },
  ] satisfies DevStoredEvidence[],
});

describe("devcouncilTaskIdFromTags", () => {
  it("extracts the devcouncil id from a tag", () => {
    expect(devcouncilTaskIdFromTags({ tags: ["epic:x", "devcouncil:TASK-001"] })).toBe("TASK-001");
  });

  it("returns undefined when there is no devcouncil tag", () => {
    expect(devcouncilTaskIdFromTags({ tags: ["auth", "bug"] })).toBeUndefined();
    expect(devcouncilTaskIdFromTags({ tags: undefined })).toBeUndefined();
  });
});

describe("buildTaskEvidenceView", () => {
  it("correlates a board task to its requirements and evidence", () => {
    const view = buildTaskEvidenceView({ tags: ["devcouncil:TASK-001"] }, graph());
    expect(view).not.toBeNull();
    expect(view?.task.id).toBe("TASK-001");
    expect(view?.requirements.map((r) => r.id)).toEqual(["REQ-001"]);
    // only evidence for this task (TASK-999 excluded)
    expect(view?.evidence.map((e) => e.id)).toEqual([1, 2]);
  });

  it("returns null for a task that was not DevCouncil-planned", () => {
    expect(buildTaskEvidenceView({ tags: ["auth"] }, graph())).toBeNull();
  });

  it("returns null when the graph has no matching task", () => {
    expect(buildTaskEvidenceView({ tags: ["devcouncil:TASK-404"] }, graph())).toBeNull();
  });

  it("tolerates malformed requirementIdsJson", () => {
    const g = graph();
    g.tasks[0].requirementIdsJson = "{not json";
    const view = buildTaskEvidenceView({ tags: ["devcouncil:TASK-001"] }, g);
    expect(view?.requirements).toEqual([]);
  });
});

describe("evidenceLabel", () => {
  it("prefers command/file/name from the payload", () => {
    expect(evidenceLabel({ id: 1, kind: "command", dataJson: '{"command":"npm test"}' })).toBe("npm test");
    expect(evidenceLabel({ id: 2, kind: "diff", dataJson: '{"file":"src/theme.ts"}' })).toBe("src/theme.ts");
  });

  it("falls back to the kind when payload is missing or unhelpful", () => {
    expect(evidenceLabel({ id: 3, kind: "test", dataJson: null })).toBe("test");
    expect(evidenceLabel({ id: 4, kind: "test", dataJson: "{}" })).toBe("test");
  });
});
