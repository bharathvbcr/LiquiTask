import { describe, expect, it } from "vitest";
import { parseQuickTask } from "../taskParser";

describe("taskParser", () => {
  it("should parse simple title", () => {
    const result = parseQuickTask("Just a task");
    expect(result.title).toBe("Just a task");
    expect(result.tags).toHaveLength(0);
  });

  it("should parse priorities", () => {
    expect(parseQuickTask("Task !h").priority).toBe("high");
    expect(parseQuickTask("Task !high").priority).toBe("high");
    expect(parseQuickTask("Task !m").priority).toBe("medium");
    expect(parseQuickTask("Task !medium").priority).toBe("medium");
    expect(parseQuickTask("Task !l").priority).toBe("low");
    expect(parseQuickTask("Task !low").priority).toBe("low");
  });

  it("should parse project", () => {
    const result = parseQuickTask("Task #work");
    expect(result.projectName).toBe("work");
    expect(result.title).toBe("Task");
  });

  it("should parse time estimates", () => {
    expect(parseQuickTask("Task ~30m").timeEstimate).toBe(30);
    expect(parseQuickTask("Task ~1.5h").timeEstimate).toBe(90);
    expect(parseQuickTask("Task ~2h").timeEstimate).toBe(120);
  });

  it("should parse tags", () => {
    const result = parseQuickTask("Task +urgent +bug");
    expect(result.tags).toEqual(["urgent", "bug"]);
    expect(result.title).toBe("Task");
  });

  it("should parse due dates: @today, @tomorrow, @nextweek", () => {
    const now = new Date();

    const todayRes = parseQuickTask("Task @today");
    expect(todayRes.dueDate?.getDate()).toBe(now.getDate());

    const tomRes = parseQuickTask("Task @tom");
    const tom = new Date();
    tom.setDate(now.getDate() + 1);
    expect(tomRes.dueDate?.getDate()).toBe(tom.getDate());

    const nextWeekRes = parseQuickTask("Task @next week");
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
    expect(nextWeekRes.dueDate?.getDate()).toBe(nextWeek.getDate());
  });

  it("should parse date format @MM/DD", () => {
    const result = parseQuickTask("Task @12/25");
    expect(result.dueDate?.getMonth()).toBe(11);
    expect(result.dueDate?.getDate()).toBe(25);
  });

  it("should handle multiple markers combined", () => {
    const result = parseQuickTask("Buy milk !high #groceries +fridge @tomorrow ~5m");
    expect(result.title).toBe("Buy milk");
    expect(result.priority).toBe("high");
    expect(result.projectName).toBe("groceries");
    expect(result.tags).toEqual(["fridge"]);
    expect(result.timeEstimate).toBe(5);
    expect(result.dueDate).toBeDefined();
  });
});
