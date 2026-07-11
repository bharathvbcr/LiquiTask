import { describe, expect, it } from "vitest";
import { type AutomationRule, AutomationService } from "../automationService";

describe("automation timezone parity", () => {
  it("isRuleDue uses local wall-clock getters", () => {
    const service = new AutomationService();
    const rule: AutomationRule = {
      id: "r1",
      name: "Local noon",
      enabled: true,
      trigger: "onSchedule",
      schedule: { frequency: "daily", time: "12:00" },
      actions: [{ type: "addTag", value: "noon" }],
    };

    const localNoon = new Date(2024, 5, 15, 12, 0, 0);
    const localOnePm = new Date(2024, 5, 15, 13, 0, 0);

    expect((service as any).isRuleDue(rule, localNoon)).toBe(true);
    expect((service as any).isRuleDue(rule, localOnePm)).toBe(false);
  });
});
