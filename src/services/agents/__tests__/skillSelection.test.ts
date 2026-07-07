import { describe, expect, it } from "vitest";

import type { SkillCatalogEntry } from "../../../core/skills/mergeSkillCatalog";
import type { Task } from "../../../../types";
import {
  catalogEntryToSkill,
  scoreEntry,
  selectSkillsForTask,
  taskQueryTokens,
  tokenize,
} from "../skillSelection";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  jobId: "JOB-1",
  projectId: "proj-1",
  title: "Fix login redirect loop",
  summary: "Users bounce between /login and /home when the session cookie is stale.",
  assignee: "Claude",
  priority: "high",
  status: "Pending",
  createdAt: new Date("2026-01-01"),
  subtasks: [],
  attachments: [],
  tags: ["auth"],
  timeEstimate: 0,
  timeSpent: 0,
  ...overrides,
});

const captured = (title: string, summary: string, id = title): SkillCatalogEntry => ({
  id,
  title,
  summary,
  origin: "captured",
  workingDir: "/repo",
});

const installed = (title: string, summary: string, id = title): SkillCatalogEntry => ({
  id: `installed:${id}`,
  title,
  summary,
  origin: "installed",
  provider: "claude",
  sourcePath: `/skills/${id}`,
});

describe("tokenize", () => {
  it("drops stopwords and 1-2 char noise, lowercases the rest", () => {
    expect(tokenize("Fix the ID of a Login redirect")).toEqual(["fix", "login", "redirect"]);
  });
});

describe("scoreEntry", () => {
  it("weights a title match above a summary match", () => {
    const q = taskQueryTokens(makeTask());
    const titleHit = scoreEntry(captured("Login helper", "unrelated body"), q);
    const summaryHit = scoreEntry(captured("Unrelated", "login cookie session"), q);
    expect(titleHit).toBeGreaterThan(0);
    expect(summaryHit).toBeGreaterThan(0);
    // "login" in a title (=2) beats a lone "login" in a summary (=1)
    expect(scoreEntry(captured("login", "x"), q)).toBeGreaterThan(
      scoreEntry(captured("x", "login"), q),
    );
  });
});

describe("selectSkillsForTask", () => {
  it("ranks task-relevant skills first", () => {
    const catalog = [
      captured("Update invoice PDF export", "quarterly billing"),
      captured("Fix login redirect", "auth session cookie handling"),
    ];
    const [first] = selectSkillsForTask(makeTask(), catalog);
    expect(first.title).toBe("Fix login redirect");
  });

  it("includes installed skills only when they match the task", () => {
    const catalog = [
      installed("Login session helper", "refresh auth cookie on login"),
      installed("Kubernetes deploy", "helm chart rollout"),
    ];
    const picked = selectSkillsForTask(makeTask(), catalog).map((e) => e.title);
    expect(picked).toContain("Login session helper");
    expect(picked).not.toContain("Kubernetes deploy");
  });

  it("keeps captured skills even with zero keyword overlap (fallback team knowledge)", () => {
    const catalog = [captured("Totally unrelated skill", "nothing in common here")];
    expect(selectSkillsForTask(makeTask(), catalog)).toHaveLength(1);
  });

  it("respects the limit", () => {
    const catalog = Array.from({ length: 9 }, (_, i) =>
      captured(`login skill ${i}`, "auth session cookie", `s${i}`),
    );
    expect(selectSkillsForTask(makeTask(), catalog, 3)).toHaveLength(3);
  });

  it("prefers captured over installed on an equal score", () => {
    const catalog = [
      installed("login", "auth"),
      captured("login", "auth"),
    ];
    const [first] = selectSkillsForTask(makeTask(), catalog);
    expect(first.origin).toBe("captured");
  });
});

describe("catalogEntryToSkill", () => {
  it("maps title/summary and records origin in agentId", () => {
    const skill = catalogEntryToSkill(installed("Login helper", "body"));
    expect(skill.title).toBe("Login helper");
    expect(skill.summary).toBe("body");
    expect(skill.agentId).toBe("installed");
  });
});
