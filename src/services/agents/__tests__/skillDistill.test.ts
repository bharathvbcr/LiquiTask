import { describe, expect, it } from "vitest";

import { distillSkillSummary } from "../skillDistill";

describe("distillSkillSummary", () => {
  it("returns an empty string for empty input", () => {
    expect(distillSkillSummary("")).toBe("");
    expect(distillSkillSummary("   ")).toBe("");
  });

  it("leads with the approach (first sentence or two)", () => {
    const raw =
      "Refactored the auth token refresh so stale cookies re-issue. Added a regression test. Then cleaned up logging.";
    const out = distillSkillSummary(raw);
    expect(out).toContain("Approach:");
    expect(out).toContain("Refactored the auth token refresh");
    // third sentence should not be in the approach line
    expect(out).not.toContain("cleaned up logging");
  });

  it("lists file paths it finds under Files", () => {
    const raw =
      "Updated the service. Changed src/auth/authService.ts and src/auth/__tests__/authService.test.ts to fix it.";
    const out = distillSkillSummary(raw);
    expect(out).toContain("Files:");
    expect(out).toContain("src/auth/authService.ts");
    expect(out).toContain("src/auth/__tests__/authService.test.ts");
  });

  it("surfaces cautionary sentences (beyond the approach) under Watch out", () => {
    const raw =
      "Wired the new endpoint. Added a redirect handler. Be careful: the session cookie must be set before the redirect or it loops.";
    const out = distillSkillSummary(raw);
    expect(out).toContain("Watch out:");
    expect(out).toContain("session cookie must be set");
  });

  it("omits Files / Watch out when there is nothing to add", () => {
    const out = distillSkillSummary("Did a simple thing and it worked fine overall here.");
    expect(out).toContain("Approach:");
    expect(out).not.toContain("Files:");
    expect(out).not.toContain("Watch out:");
  });

  it("collapses whitespace and caps length", () => {
    const raw = `First   sentence   here.\n\n${"x".repeat(4000)}`;
    const out = distillSkillSummary(raw);
    expect(out).not.toContain("  "); // no double spaces
    expect(out.length).toBeLessThanOrEqual(1200);
  });
});
