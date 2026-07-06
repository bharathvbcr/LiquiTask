import { describe, expect, it } from "vitest";

import {
  ForbiddenActionError,
  CAMPAIGN_ROLES,
  assertAllowed,
  getRole,
  isAllowed,
  roleInstructions,
} from "../campaignRoles";
import type { CampaignAction, CampaignRank } from "../campaignTypes";

describe("campaign roles", () => {
  it("defines the full chain of command", () => {
    expect(getRole("commander").reportsTo).toBeNull();
    expect(getRole("lead").reportsTo).toBe("commander");
    expect(getRole("worker").reportsTo).toBe("reviewer");
    expect(getRole("reviewer").reportsTo).toBe("lead");
  });

  const forbidden: Array<[CampaignRank, CampaignAction]> = [
    ["commander", "execute_task"],
    ["commander", "write_dashboard"],
    ["lead", "execute_task"],
    ["lead", "qc_review"],
    ["worker", "qc_review"],
    ["worker", "contact_human"],
    ["reviewer", "execute_task"],
    ["reviewer", "assign"],
  ];

  it.each(forbidden)("forbids %s from %s", (rank, action) => {
    expect(() => assertAllowed(rank, action)).toThrow(ForbiddenActionError);
    expect(isAllowed(rank, action)).toBe(false);
  });

  const permitted: Array<[CampaignRank, CampaignAction]> = [
    ["commander", "relay_order"],
    ["lead", "write_dashboard"],
    ["lead", "assign"],
    ["worker", "execute_task"],
    ["reviewer", "qc_review"],
  ];

  it.each(permitted)("permits %s to %s", (rank, action) => {
    expect(() => assertAllowed(rank, action)).not.toThrow();
  });

  it("renders role instructions as markdown", () => {
    const text = roleInstructions("lead");
    expect(text).toContain("Lead");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("covers every rank", () => {
    expect(Object.keys(CAMPAIGN_ROLES).sort()).toEqual(["commander", "lead", "reviewer", "worker"]);
  });
});
