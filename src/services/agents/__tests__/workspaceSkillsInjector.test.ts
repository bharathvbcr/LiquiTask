import { describe, expect, it } from "vitest";

import type { SkillCatalogEntry } from "../../../core/skills/mergeSkillCatalog";
import {
  INJECTED_SKILLS_SUBDIR,
  INJECTED_SKILLS_SUBDIRS,
  planSkillInjection,
  renderSkillMarkdown,
  slugifySkill,
  toYamlScalar,
} from "../workspaceSkillsInjector";

const captured = (id: string, title: string, summary = "How to do it"): SkillCatalogEntry => ({
  id,
  title,
  summary,
  origin: "captured",
  workingDir: "/repo",
});

const installed = (id: string, title: string, summary = "Pack skill"): SkillCatalogEntry => ({
  id,
  title,
  summary,
  origin: "installed",
  provider: "claude",
  sourcePath: `/skills/${id}`,
});

describe("slugifySkill", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugifySkill("Fix Auth Bug!")).toBe("fix-auth-bug");
  });

  it("trims leading/trailing dashes and caps length", () => {
    expect(slugifySkill("  ***  ")).toBe("skill");
    expect(slugifySkill("a".repeat(80)).length).toBeLessThanOrEqual(60);
  });
});

describe("toYamlScalar", () => {
  it("collapses whitespace and quotes the value", () => {
    expect(toYamlScalar("hello   world")).toBe('"hello world"');
  });

  it("escapes quotes and backslashes so frontmatter can't break", () => {
    expect(toYamlScalar('say "hi"\\path')).toBe('"say \\"hi\\"\\\\path"');
  });

  it("truncates to the max length", () => {
    expect(toYamlScalar("x".repeat(300)).length).toBeLessThanOrEqual(202); // + quotes
  });
});

describe("renderSkillMarkdown", () => {
  it("emits frontmatter, heading, body and provenance", () => {
    const md = renderSkillMarkdown(captured("s1", "Reset Cache", "Delete node_modules and reinstall"));
    expect(md).toContain("name: \"Reset Cache\"");
    expect(md).toContain("description: \"Delete node_modules and reinstall\"");
    expect(md).toContain("# Reset Cache");
    expect(md).toContain("Delete node_modules and reinstall");
    expect(md).toContain("Injected by LiquiTask DevCouncil workspace sync");
  });

  it("notes the installed provider for installed skills", () => {
    const md = renderSkillMarkdown(installed("i1", "Lint Rules"));
    expect(md).toContain("installed skill (claude)");
  });
});

describe("planSkillInjection", () => {
  it("writes INDEX first, under .claude/skills/liquitask, captured before installed", () => {
    const plan = planSkillInjection([installed("i1", "Zebra"), captured("c1", "Apple")], "/repo");
    expect(plan.baseDir).toBe(`/repo/${INJECTED_SKILLS_SUBDIR}`);
    expect(plan.files[0].path).toBe(`/repo/${INJECTED_SKILLS_SUBDIR}/INDEX.md`);
    // captured ("Apple") should be materialized before installed ("Zebra")
    expect(plan.files[1].path).toContain("/apple/SKILL.md");
    expect(plan.files[2].path).toContain("/zebra/SKILL.md");
  });

  it("normalizes a trailing slash on the workspace dir", () => {
    const plan = planSkillInjection([captured("c1", "Apple")], "/repo/");
    expect(plan.baseDir).toBe(`/repo/${INJECTED_SKILLS_SUBDIR}`);
  });

  it("dedupes colliding slugs", () => {
    const plan = planSkillInjection(
      [captured("c1", "Fix Bug"), captured("c2", "Fix Bug")],
      "/repo",
    );
    const skillPaths = plan.files.slice(1).map((f) => f.path);
    expect(skillPaths[0]).toContain("/fix-bug/SKILL.md");
    expect(skillPaths[1]).toContain("/fix-bug-2/SKILL.md");
  });

  it("each skill file's parentDir is its own folder (so ensureDir works)", () => {
    const plan = planSkillInjection([captured("c1", "Apple")], "/repo");
    const skillFile = plan.files[1];
    expect(skillFile.parentDir).toBe(`/repo/${INJECTED_SKILLS_SUBDIR}/apple`);
    expect(skillFile.path).toBe(`${skillFile.parentDir}/SKILL.md`);
  });

  it("caps the number of injected skills", () => {
    const many = Array.from({ length: 45 }, (_, i) => captured(`c${i}`, `Skill ${i}`));
    const plan = planSkillInjection(many, "/repo");
    // INDEX + at most 40 skill files
    expect(plan.files.length).toBe(41);
  });

  it("supports cursor and grok native subdirs", () => {
    expect(INJECTED_SKILLS_SUBDIRS).toEqual([
      ".claude/skills/liquitask",
      ".cursor/skills/liquitask",
      ".grok/skills/liquitask",
    ]);
    const cursorPlan = planSkillInjection([captured("c1", "Apple")], "/repo", ".cursor/skills/liquitask");
    expect(cursorPlan.baseDir).toBe("/repo/.cursor/skills/liquitask");
    const grokPlan = planSkillInjection([captured("c1", "Apple")], "/repo", ".grok/skills/liquitask");
    expect(grokPlan.baseDir).toBe("/repo/.grok/skills/liquitask");
  });
});
