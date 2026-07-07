import { describe, expect, it } from "vitest";
import { mergeSkillCatalog, normalizeSkillTitle, type InstalledSkill } from "../mergeSkillCatalog";
import type { AgentSkill } from "../../../../types";

function makeCaptured(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    title: "Fix flaky tests",
    summary: "Stabilised the vitest suite by pinning fake timers.",
    workingDir: "/repo/app",
    taskId: "task-1",
    agentId: "agent-1",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function makeInstalled(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    key: "pdf-tools",
    name: "PDF Tools",
    description: "Read and fill PDFs.",
    source_path: "/home/u/.claude/skills/pdf-tools",
    provider: "claude-code",
    root: "/home/u/.claude/skills",
    file_count: 3,
    ...overrides,
  };
}

describe("normalizeSkillTitle", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeSkillTitle("  Fix   Flaky\tTests ")).toBe("fix flaky tests");
  });
});

describe("mergeSkillCatalog", () => {
  it("returns empty for empty inputs, including undefined installed list", () => {
    expect(mergeSkillCatalog([], undefined)).toEqual([]);
    expect(mergeSkillCatalog([], [])).toEqual([]);
  });

  it("maps both origins onto the unified entry shape", () => {
    const entries = mergeSkillCatalog([makeCaptured()], [makeInstalled()]);
    expect(entries).toEqual([
      {
        id: "skill-1",
        title: "Fix flaky tests",
        summary: "Stabilised the vitest suite by pinning fake timers.",
        origin: "captured",
        workingDir: "/repo/app",
      },
      {
        id: "installed:claude-code:pdf-tools",
        title: "PDF Tools",
        summary: "Read and fill PDFs.",
        origin: "installed",
        provider: "claude-code",
        sourcePath: "/home/u/.claude/skills/pdf-tools",
      },
    ]);
  });

  it("dedupes by normalized title across origins, captured winning", () => {
    const entries = mergeSkillCatalog(
      [makeCaptured({ title: "PDF Tools", id: "cap-1" })],
      [makeInstalled({ name: "  pdf   tools " })],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "cap-1", origin: "captured" });
  });

  it("dedupes within a source, first (newest) occurrence winning", () => {
    const entries = mergeSkillCatalog(
      [
        makeCaptured({ id: "newest", title: "Deploy checklist" }),
        makeCaptured({ id: "older", title: "deploy CHECKLIST" }),
      ],
      undefined,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("newest");
  });

  it("defaults a missing installed description to an empty summary", () => {
    const [entry] = mergeSkillCatalog([], [makeInstalled({ description: undefined })]);
    expect(entry.summary).toBe("");
  });

  it("skips entries whose title is blank", () => {
    expect(mergeSkillCatalog([makeCaptured({ title: "   " })], [makeInstalled({ name: "" })])).toEqual([]);
  });

  it("sorts captured before installed, then by title", () => {
    const entries = mergeSkillCatalog(
      [makeCaptured({ id: "c2", title: "Zeta" }), makeCaptured({ id: "c1", title: "Alpha" })],
      [makeInstalled({ key: "b", name: "Beta" })],
    );
    expect(entries.map((e) => `${e.origin}:${e.title}`)).toEqual([
      "captured:Alpha",
      "captured:Zeta",
      "installed:Beta",
    ]);
  });
});
