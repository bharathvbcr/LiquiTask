import { beforeEach, describe, expect, it, vi } from "vitest";

// The DLQ persists via storageService and mirrors audit facts into the task
// event log — both are stubbed so the tests exercise queue semantics only.
vi.mock("../storageService", () => {
  const data = new Map<string, unknown>();
  return {
    default: {
      get: (key: string, fallback: unknown) => data.get(key) ?? fallback,
      set: async (key: string, value: unknown) => {
        data.set(key, JSON.parse(JSON.stringify(value)));
      },
    },
  };
});

vi.mock("../../core/events/taskEventStore", () => ({
  default: { appendSafe: vi.fn(async () => true) },
}));

import deadLetterService from "../deadLetterService";

describe("deadLetterService", () => {
  beforeEach(() => {
    // Drain any leftover open letters between tests.
    for (const letter of deadLetterService.getOpen()) {
      deadLetterService.discard(letter.id);
    }
  });

  it("records a letter and lists it as open", () => {
    const letter = deadLetterService.record({
      kind: "merge",
      title: "Merge failed: fix auth",
      detail: "conflict in src/auth.ts",
      taskId: "task-1",
      runId: "run-1",
      payload: { branch: "agent/run-1-fix-auth" },
    });
    expect(letter.status).toBe("open");
    expect(deadLetterService.getOpen().map((l) => l.id)).toContain(letter.id);
  });

  it("resolves a letter when its retry handler succeeds", async () => {
    const handler = vi.fn(async () => undefined);
    deadLetterService.registerRetryHandler("merge", handler);
    const letter = deadLetterService.record({
      kind: "merge",
      title: "Merge failed",
      detail: "transient",
      payload: {},
    });

    const outcome = await deadLetterService.retry(letter.id);
    expect(outcome.ok).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(deadLetterService.getById(letter.id)?.status).toBe("resolved");
  });

  it("keeps the letter open and appends the error when retry fails", async () => {
    deadLetterService.registerRetryHandler("run", async () => {
      throw new Error("agent still broken");
    });
    const letter = deadLetterService.record({
      kind: "run",
      title: "Run failed",
      detail: "exit 1",
      payload: {},
    });

    const outcome = await deadLetterService.retry(letter.id);
    expect(outcome.ok).toBe(false);
    const after = deadLetterService.getById(letter.id);
    expect(after?.status).toBe("open");
    expect(after?.attempts).toBe(1);
    expect(after?.detail).toContain("agent still broken");
  });

  it("fails retry gracefully when no handler is registered", async () => {
    const letter = deadLetterService.record({
      kind: "automation",
      title: "Rule failed",
      detail: "boom",
      payload: {},
    });
    const outcome = await deadLetterService.retry(letter.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/No retry handler/);
  });

  it("discard closes the letter and removes it from the open feed", () => {
    const letter = deadLetterService.record({
      kind: "mcp-action",
      title: "update_status failed",
      detail: "hooks missing",
      payload: {},
    });
    deadLetterService.discard(letter.id);
    expect(deadLetterService.getById(letter.id)?.status).toBe("discarded");
    expect(deadLetterService.getOpen().map((l) => l.id)).not.toContain(letter.id);
  });

  it("discardAll clears every open letter and returns the count", () => {
    deadLetterService.record({ kind: "merge", title: "a", detail: "1", payload: {} });
    deadLetterService.record({ kind: "run", title: "b", detail: "2", payload: {} });
    deadLetterService.record({ kind: "automation", title: "c", detail: "3", payload: {} });
    expect(deadLetterService.getOpen()).toHaveLength(3);

    const cleared = deadLetterService.discardAll();
    expect(cleared).toBe(3);
    expect(deadLetterService.getOpen()).toHaveLength(0);
    // A second call is a no-op.
    expect(deadLetterService.discardAll()).toBe(0);
  });

  it("notifies subscribers with the open set", () => {
    const seen: number[] = [];
    const unsubscribe = deadLetterService.subscribe((open) => seen.push(open.length));
    const letter = deadLetterService.record({
      kind: "merge",
      title: "x",
      detail: "y",
      payload: {},
    });
    deadLetterService.discard(letter.id);
    unsubscribe();
    // initial snapshot, after record, after discard
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[seen.length - 1]).toBe(0);
  });
});
