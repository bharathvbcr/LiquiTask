import { describe, expect, it } from "vitest";
import type { BoardColumn } from "../../../types";
import {
  generateTaskId,
  getBacklogColumnId,
  getCompletedColumnIds,
  isTaskComplete,
} from "../taskUtils";

describe("taskUtils", () => {
  describe("getBacklogColumnId", () => {
    it("returns the first non-completed column", () => {
      const columns: BoardColumn[] = [
        { id: "Done", title: "Done", color: "#000", isCompleted: true },
        { id: "Todo", title: "Todo", color: "#fff" },
      ];
      expect(getBacklogColumnId(columns)).toBe("Todo");
    });

    it("falls back to the first column when all are completed", () => {
      const columns: BoardColumn[] = [
        { id: "Done", title: "Done", color: "#000", isCompleted: true },
      ];
      expect(getBacklogColumnId(columns)).toBe("Done");
    });

    it("falls back to Task when columns are empty", () => {
      expect(getBacklogColumnId([])).toBe("Task");
    });
  });

  describe("generateTaskId", () => {
    it("generates unique ids", () => {
      const a = generateTaskId();
      const b = generateTaskId();
      expect(a).not.toBe(b);
      expect(a.startsWith("task-")).toBe(true);
    });

    it("includes an optional suffix", () => {
      expect(generateTaskId(3)).toMatch(/-3$/);
    });
  });

  describe("getCompletedColumnIds", () => {
    it("returns ids for columns marked completed", () => {
      const columns: BoardColumn[] = [
        { id: "Todo", title: "Todo", color: "#fff" },
        { id: "Done", title: "Done", color: "#000", isCompleted: true },
      ];
      expect(getCompletedColumnIds(columns)).toEqual(new Set(["Done"]));
    });
  });

  describe("isTaskComplete", () => {
    const completedIds = new Set(["Completed"]);

    it("returns true when completedAt is set", () => {
      expect(isTaskComplete({ status: "Todo", completedAt: new Date() }, completedIds)).toBe(
        true,
      );
    });

    it("returns true when status is a completed column", () => {
      expect(isTaskComplete({ status: "Completed" }, completedIds)).toBe(true);
    });

    it("returns false for active backlog tasks", () => {
      expect(isTaskComplete({ status: "Todo" }, completedIds)).toBe(false);
    });
  });
});
