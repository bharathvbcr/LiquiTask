import { describe, expect, it } from "vitest";
import type { DuplicateGroup, MergeSuggestion, TaskCluster } from "../../types";
import {
  filterClustersToKnownTasks,
  filterProjectAssignments,
  sanitizeMergeSubtasks,
  validateMergeSuggestion,
} from "../aiModalTrust";

describe("aiModalTrust", () => {
  const group: DuplicateGroup = {
    id: "g1",
    confidence: 0.9,
    reasons: ["similar"],
    tasks: [
      { id: "a", title: "A", subtasks: [], tags: [] } as any,
      { id: "b", title: "B", subtasks: [], tags: [] } as any,
    ],
  };

  it("validateMergeSuggestion rejects ids outside the duplicate group", () => {
    const raw: MergeSuggestion = {
      keepTaskId: "evil",
      archiveTaskIds: ["a"],
      mergedFields: {},
      reasoning: "bad",
    };
    expect(validateMergeSuggestion(group, raw)).toBeNull();
  });

  it("validateMergeSuggestion allowlists archive ids and sanitizes subtasks", () => {
    const raw: MergeSuggestion = {
      keepTaskId: "a",
      archiveTaskIds: ["b", "outside"],
      mergedFields: {
        subtasks: [{ title: "Step 1", completed: false }, "Step 2", { foo: 1 }],
        tags: ["x", 1 as unknown as string],
      },
      reasoning: "ok",
    };
    const validated = validateMergeSuggestion(group, raw)!;
    expect(validated.archiveTaskIds).toEqual(["b"]);
    expect(validated.mergedFields.subtasks).toHaveLength(2);
    expect(validated.mergedFields.tags).toEqual(["x"]);
  });

  it("sanitizeMergeSubtasks dedupes titles case-insensitively", () => {
    expect(sanitizeMergeSubtasks(["One", "one", { title: "Two" }])).toEqual([
      expect.objectContaining({ title: "One" }),
      expect.objectContaining({ title: "Two" }),
    ]);
  });

  it("filterClustersToKnownTasks drops unknown ids and empty clusters", () => {
    const clusters: TaskCluster[] = [
      { id: "c1", taskIds: ["1", "ghost"], theme: "A", suggestedTags: [], confidence: 0.8 },
      { id: "c2", taskIds: ["ghost"], theme: "B", suggestedTags: [], confidence: 0.8 },
    ];
    const tasks = [{ id: "1", title: "T1" }] as any[];
    expect(filterClustersToKnownTasks(clusters, tasks, 2)).toEqual([]);
    expect(filterClustersToKnownTasks(clusters, tasks, 1)).toHaveLength(1);
  });

  it("filterProjectAssignments requires known task and project ids", () => {
    const filtered = filterProjectAssignments(
      [
        { taskId: "1", suggestedProjectId: "p2", confidence: 0.9, reasoning: "ok" },
        { taskId: "ghost", suggestedProjectId: "p2", confidence: 0.9, reasoning: "bad task" },
        { taskId: "1", suggestedProjectId: "ghost", confidence: 0.9, reasoning: "bad project" },
      ],
      [{ id: "1", title: "T" } as any],
      [{ id: "p2", name: "P2" }],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskId).toBe("1");
  });
});
