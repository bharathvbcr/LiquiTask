import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../../../types";
import agentMcpService from "../agentMcpService";

// A task whose FIRST subtask was persisted with a non-string (object) title —
// the exact shape that crashed `s.title.toLowerCase()` in toggle_subtask.
const task = {
  id: "t1",
  title: "Redesign the pill",
  projectId: "p1",
  status: "in-progress",
  subtasks: [
    { id: "s1", title: { title: "garbage" } as unknown as string, completed: false },
    { id: "s2", title: "Rework styles", completed: false },
  ],
  activity: [],
} as unknown as Task;

type ToolReq = {
  tool: string;
  taskId: string;
  args: Record<string, unknown>;
  requestId: string;
  runId: string;
};

describe("toggle_subtask with a malformed subtask title", () => {
  it("does not fail the action and toggles the matching subtask", async () => {
    const updateTask = vi.fn();
    agentMcpService.setHooks({
      getTask: () => task,
      getColumns: () => [],
      updateTask,
      createTask: () => null,
      getRunsForTask: () => [],
    });

    const svc = agentMcpService as unknown as {
      handleTool: (req: ToolReq) => Promise<{ content?: unknown; error?: string }>;
    };

    const res = await svc.handleTool({
      tool: "toggle_subtask",
      taskId: "t1",
      args: { subtask: "Rework styles" },
      requestId: "req-1",
      runId: "run-1",
    });

    // Old code threw "…title.toLowerCase is not a function", caught + surfaced
    // as res.error. The fix coerces the bad title so matching proceeds.
    expect(res.error).toBeUndefined();
    expect(updateTask).toHaveBeenCalledTimes(1);
    const updates = updateTask.mock.calls[0][1] as {
      subtasks: Array<{ id: string; completed: boolean }>;
    };
    expect(updates.subtasks.find((s) => s.id === "s2")?.completed).toBe(true);
  });
});
