import { describe, expect, it } from "vitest";
import {
  buildDeadLetterQuickAddPrefill,
  collectParseWarnings,
  extractFilePathsFromPaste,
  exportQuickAddTemplates,
  findDuplicateTaskTitles,
  findSimilarTaskTitles,
  formatDueDateForForm,
  formatParsedTaskSummary,
  fuzzyCompletionScore,
  getBatchLineStatus,
  getQuickAddCompletions,
  hasBatchBlockingErrors,
  hasQuickAddSyntax,
  importQuickAddTemplates,
  buildBoardContextQuickAddPrefill,
  parseFormDueDate,
  parseTimeAtToken,
  recordCompletionRecency,
  removeQuickAddTemplate,
  taskToQuickAddSyntax,
  normalizeTaskTitle,
  parseMultipleQuickTasks,
  parseQuickTask,
  parsedTaskToJson,
  resolveParsedPriority,
  safeParseQuickTask,
  segmentQuickAddInput,
  SIMILAR_TITLE_THRESHOLD,
  suggestQuickAddMetadata,
  titleSimilarityScore,
  upsertQuickAddTemplate,
  validateQuickAddParsed,
} from "../taskParser";

const emptyExtras = { filePaths: [], usedExplicitTitle: false, warnings: [] as const };

describe("taskParser", () => {
  it("should parse simple title", () => {
    const result = parseQuickTask("Just a task");
    expect(result.title).toBe("Just a task");
    expect(result.tags).toHaveLength(0);
    expect(result.filePaths).toEqual([]);
  });

  it("should parse priorities", () => {
    expect(parseQuickTask("Task !h")).toMatchObject({ priority: "high", ...emptyExtras });
    expect(parseQuickTask("Task !high")).toMatchObject({ priority: "high", ...emptyExtras });
    expect(parseQuickTask("Task !m")).toMatchObject({ priority: "medium", ...emptyExtras });
    expect(parseQuickTask("Task !medium")).toMatchObject({ priority: "medium", ...emptyExtras });
    expect(parseQuickTask("Task !l")).toMatchObject({ priority: "low", ...emptyExtras });
    expect(parseQuickTask("Task !low")).toMatchObject({ priority: "low", ...emptyExtras });
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

  it("should parse relative due dates @+3d and @+1w", () => {
    const now = new Date();

    const threeDays = parseQuickTask("Task @+3d");
    const expectedThree = new Date();
    expectedThree.setDate(now.getDate() + 3);
    expect(threeDays.dueDate?.getDate()).toBe(expectedThree.getDate());

    const oneWeek = parseQuickTask("Task @+1w");
    const expectedWeek = new Date();
    expectedWeek.setDate(now.getDate() + 7);
    expect(oneWeek.dueDate?.getDate()).toBe(expectedWeek.getDate());
  });

  it("builds board context quick-add prefill from project and column", () => {
    expect(buildBoardContextQuickAddPrefill("My Work", "In Progress")).toBe(
      "$Title #MyWork >InProgress",
    );
    expect(buildBoardContextQuickAddPrefill()).toBe("");
  });

  it("parses subtask, link, and recurring quick-add tokens", () => {
    const parsed = parseQuickTask(
      "$Ship release !h *weekly2 >>Write tests >>Update docs &https://example.com",
    );
    expect(parsed.title).toBe("Ship release");
    expect(parsed.priority).toBe("high");
    expect(parsed.recurringFrequency).toBe("weekly");
    expect(parsed.recurringInterval).toBe(2);
    expect(parsed.subtaskTitles).toEqual(["Write tests", "Update docs"]);
    expect(parsed.links).toContain("https://example.com");
  });

  it("parses @eod at 5pm local and @5pm time tokens", () => {
    const eod = parseQuickTask("$Wrap up @eod");
    expect(eod.dueDate).toBeDefined();
    expect(eod.dueDate?.getHours()).toBe(17);
    expect(eod.dueDate?.getMinutes()).toBe(0);

    const atFive = parseQuickTask("$Call @5pm");
    expect(atFive.dueDate?.getHours()).toBe(17);

    expect(parseTimeAtToken("5pm")).toEqual({ hours: 17, minutes: 0 });
    expect(parseTimeAtToken("9:30am")).toEqual({ hours: 9, minutes: 30 });
  });

  it("parses natural language dates @tomorrow and @in 3 days", () => {
    const now = new Date();
    const tomorrow = parseQuickTask("$Task @tomorrow");
    const expectedTom = new Date();
    expectedTom.setDate(now.getDate() + 1);
    expect(tomorrow.dueDate?.getDate()).toBe(expectedTom.getDate());

    const inThree = parseQuickTask("$Task @in 3 days");
    const expectedThree = new Date();
    expectedThree.setDate(now.getDate() + 3);
    expect(inThree.dueDate?.getDate()).toBe(expectedThree.getDate());
  });

  it("parses %agent, #project:Name, and :: description syntax", () => {
    const parsed = parseQuickTask(
      "$Fix merge %claude #project:OtherWork !h :: Investigate the failed merge pipeline",
    );
    expect(parsed.title).toBe("Fix merge");
    expect(parsed.assignee).toBe("claude");
    expect(parsed.projectName).toBe("OtherWork");
    expect(parsed.priority).toBe("high");
    expect(parsed.description).toContain("failed merge");
  });

  it("round-trips due dates with time through form helpers", () => {
    const due = new Date();
    due.setHours(17, 30, 0, 0);
    const formatted = formatDueDateForForm(due);
    expect(formatted).toContain("T17:30");
    const parsed = parseFormDueDate(formatted);
    expect(parsed?.getHours()).toBe(17);
    expect(parsed?.getMinutes()).toBe(30);
  });

  it("validates quick-add before create", () => {
    expect(validateQuickAddParsed(parseQuickTask("$Valid task"))).toBeNull();
    expect(validateQuickAddParsed(parseQuickTask('$""'))).toMatch(/title/i);
  });

  it("manages named template library", () => {
    const first = upsertQuickAddTemplate([], "Sprint", "$Plan sprint !h");
    expect(first).toHaveLength(1);
    const updated = upsertQuickAddTemplate(first, "Sprint", "$Plan sprint !m");
    expect(updated[0].content).toContain("!m");
    expect(removeQuickAddTemplate(updated, updated[0].id)).toHaveLength(0);
  });

  it("builds dead-letter quick-add prefill", () => {
    const prefill = buildDeadLetterQuickAddPrefill("Merge failed", "git push rejected");
    expect(prefill).toContain("$Merge failed");
    expect(prefill).toContain("::");
    expect(prefill).toContain("git push rejected");
  });

  it("parses @next week date tokens", () => {
    const nextWeek = parseQuickTask("$Plan sprint @next week");
    expect(nextWeek.dueDate).toBeDefined();
  });

  it("serializes a task into quick-add syntax", () => {
    const syntax = taskToQuickAddSyntax(
      {
        title: "Fix login",
        priority: "high",
        assignee: "devin",
        tags: ["urgent"],
        timeEstimate: 90,
        subtasks: [{ title: "Add test" }],
        recurring: { enabled: true, frequency: "daily", interval: 1 },
      },
      { projectName: "Work", columnTitle: "In Progress", priorityLabel: "high" },
    );
    expect(syntax).toContain("$Fix login");
    expect(syntax).toContain("!h");
    expect(syntax).toContain("#Work");
    expect(syntax).toContain("+urgent");
    expect(syntax).toContain("*daily");
    expect(syntax).toContain(">>Add test");
    expect(syntax).toContain(">InProgress");
  });

  it("boosts recently used completions in recency map", () => {
    const next = recordCompletionRecency({ "@src/foo.ts": 0, ">devin": 1 }, ">devin");
    expect(next[">devin"]).toBe(0);
    expect(next["@src/foo.ts"]).toBe(1);
  });

  it("reports batch line status and blocking errors", () => {
    const ok = parseQuickTask("$Task one !h");
    expect(getBatchLineStatus(ok).status).toBe("ok");

    const warning = parseQuickTask("Task !bogus");
    expect(getBatchLineStatus(warning).status).toBe("warning");

    const lines = parseMultipleQuickTasks("$Good\n\n$Also good");
    expect(hasBatchBlockingErrors(lines)).toBe(false);
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

  it("should not treat words that merely start with a marker letter as markers", () => {
    const result = parseQuickTask("Review !history");
    expect(result.priority).toBeUndefined();
    expect(result.title).toBe("Review !history");
  });

  it("should not mangle titles containing marker-like substrings", () => {
    const result = parseQuickTask("Fix the !html parser !high");
    expect(result.priority).toBe("high");
    expect(result.title).toBe("Fix the !html parser");
  });

  it("should keep @MM/DD set to today in the current year", () => {
    const now = new Date();
    const mm = now.getMonth() + 1;
    const dd = now.getDate();
    const result = parseQuickTask(`Task @${mm}/${dd}`);
    expect(result.dueDate?.getFullYear()).toBe(now.getFullYear());
    expect(result.dueDate?.getMonth()).toBe(now.getMonth());
    expect(result.dueDate?.getDate()).toBe(now.getDate());
  });

  it("should parse @MM/DD/YYYY full dates", () => {
    const result = parseQuickTask("Task @12/25/2030");
    expect(result.dueDate?.getFullYear()).toBe(2030);
    expect(result.dueDate?.getMonth()).toBe(11);
    expect(result.dueDate?.getDate()).toBe(25);
    expect(result.title).toBe("Task");
  });

  it("should parse weekday names to the next upcoming occurrence", () => {
    const result = parseQuickTask("Standup @monday");
    expect(result.title).toBe("Standup");
    expect(result.dueDate).toBeDefined();
    expect(result.dueDate?.getDay()).toBe(1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((result.dueDate!.getTime() - today.getTime()) / 86400000);
    expect(diffDays).toBeGreaterThanOrEqual(1);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it("should support short weekday forms", () => {
    expect(parseQuickTask("Task @fri").dueDate?.getDay()).toBe(5);
    expect(parseQuickTask("Task @wed").dueDate?.getDay()).toBe(3);
  });

  it("should parse combined hour+minute estimates (~1h30m)", () => {
    expect(parseQuickTask("Task ~1h30m").timeEstimate).toBe(90);
    expect(parseQuickTask("Task ~2h15m").timeEstimate).toBe(135);
  });

  it("should parse the !med medium shorthand", () => {
    expect(parseQuickTask("Task !med").priority).toBe("medium");
  });

  it("should parse >name as assignee and strip it from the title", () => {
    const parsed = parseQuickTask("Fix login bug >devin !h");
    expect(parsed.assignee).toBe("devin");
    expect(parsed.title).toBe("Fix login bug");
    expect(parsed.priority).toBe("high");
  });

  it("should not treat mid-word > as an assignee", () => {
    const parsed = parseQuickTask("Compare a>b results");
    expect(parsed.assignee).toBeUndefined();
    expect(parsed.title).toBe("Compare a>b results");
  });

  it("should combine assignee with dates and tags", () => {
    const parsed = parseQuickTask("Ship release >alex @tomorrow +urgent");
    expect(parsed.assignee).toBe("alex");
    expect(parsed.dueDate).toBeDefined();
    expect(parsed.tags).toEqual(["urgent"]);
    expect(parsed.title).toBe("Ship release");
  });

  it("should parse explicit $ title tokens", () => {
    const parsed = parseQuickTask('$Fix auth bug !h @tomorrow');
    expect(parsed.title).toBe("Fix auth bug");
    expect(parsed.usedExplicitTitle).toBe(true);
    expect(parsed.priority).toBe("high");
    expect(parsed.dueDate).toBeDefined();
  });

  it("should parse quoted $ title tokens", () => {
    const parsed = parseQuickTask('$"Fix auth bug" !h');
    expect(parsed.title).toBe("Fix auth bug");
    expect(parsed.usedExplicitTitle).toBe(true);
    expect(parsed.priority).toBe("high");
  });

  it("should parse @file/path tokens as linked files", () => {
    const parsed = parseQuickTask("Review PR @src/auth/login.ts !m");
    expect(parsed.title).toBe("Review PR");
    expect(parsed.filePaths).toEqual(["src/auth/login.ts"]);
    expect(parsed.priority).toBe("medium");
    expect(parsed.dueDate).toBeUndefined();
  });

  it("should not treat @today as a file path", () => {
    const parsed = parseQuickTask("Standup @today @src/foo.ts");
    expect(parsed.dueDate).toBeDefined();
    expect(parsed.filePaths).toEqual(["src/foo.ts"]);
  });

  it("hasQuickAddSyntax detects command markers but not plain prose", () => {
    expect(hasQuickAddSyntax("Meeting notes about the release")).toBe(false);
    expect(hasQuickAddSyntax("Fix bug !h")).toBe(true);
    expect(hasQuickAddSyntax('$Ship feature')).toBe(true);
    expect(hasQuickAddSyntax("Review @src/foo.ts")).toBe(true);
  });

  it("parses multiple file paths", () => {
    const parsed = parseQuickTask("Review @src/a.ts @lib/b.ts !m");
    expect(parsed.filePaths).toEqual(["src/a.ts", "lib/b.ts"]);
    expect(parsed.priority).toBe("medium");
  });

  it("parses $ title with spaces before markers", () => {
    const parsed = parseQuickTask('$Fix auth bug today !h');
    expect(parsed.title).toBe("Fix auth bug today");
    expect(parsed.usedExplicitTitle).toBe(true);
    expect(parsed.priority).toBe("high");
  });

  it("handles mixed command order", () => {
    const parsed = parseQuickTask("!h @tom +urgent $Ship release #work");
    expect(parsed).toMatchObject({
      title: "Ship release",
      priority: "high",
      projectName: "work",
      tags: ["urgent"],
      usedExplicitTitle: true,
    });
    expect(parsed.dueDate).toBeDefined();
  });

  it("emits warnings for invalid priority and estimate tokens", () => {
    const parsed = parseQuickTask("Task !urgent ~abc");
    expect(parsed.warnings.some((w) => w.code === "invalid_priority")).toBe(true);
    expect(parsed.warnings.some((w) => w.code === "invalid_estimate")).toBe(true);
  });

  it("emits warnings for unknown @ tokens", () => {
    const parsed = parseQuickTask("Task @foobar");
    expect(parsed.warnings.some((w) => w.code === "unknown_at_token")).toBe(true);
  });

  it("suggests date completions for partial @ tokens", () => {
    const suggestions = getQuickAddCompletions("Task @to", 8, { columns: [], projects: [] });
    expect(suggestions.some((s) => s.value === "@tom")).toBe(true);
  });

  it("suggests project completions for # tokens", () => {
    const suggestions = getQuickAddCompletions("Task #Pro", 9, {
      projects: [{ id: "p1", name: "Project Alpha" }],
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].label).toBe("Project Alpha");
  });

  it("collectParseWarnings deduplicates repeated issues", () => {
    const parsed = parseQuickTask("Task !urgent");
    const warnings = collectParseWarnings("Task !urgent", {
      title: "Task",
      tags: [],
      filePaths: [],
      usedExplicitTitle: false,
    });
    expect(warnings.filter((w) => w.code === "invalid_priority")).toHaveLength(1);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("suggests workspace file completions for @ path fragments", () => {
    const suggestions = getQuickAddCompletions("Review @src/auth", 15, {
      workspaceFiles: ["src/auth/login.ts", "src/auth/token.ts"],
    });
    expect(suggestions.some((s) => s.kind === "file" && s.value === "@src/auth/login.ts")).toBe(
      true,
    );
  });

  it("suggests assignee completions when column names do not match", () => {
    const suggestions = getQuickAddCompletions("Task >dev", 8, {
      columns: [{ id: "c1", title: "Pending" }],
      assignees: ["devin", "alex"],
    });
    expect(suggestions.some((s) => s.kind === "assignee" && s.value === ">devin")).toBe(true);
  });

  it("parses multiple newline-separated quick-add lines", () => {
    const parsed = parseMultipleQuickTasks("$Task one !h\n$Task two !m");
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Task one");
    expect(parsed[1].title).toBe("Task two");
  });

  it("formats parsed task summaries and JSON", () => {
    const parsed = parseQuickTask("$Fix bug !h +urgent");
    expect(formatParsedTaskSummary(parsed)).toContain("Title: Fix bug");
    expect(parsedTaskToJson(parsed)).toContain('"priority": "high"');
  });

  it("segments quick-add syntax tokens for highlighting", () => {
    const segments = segmentQuickAddInput("$Title !h @tom +tag >>step &https://x.com *daily");
    expect(segments.some((s) => s.kind === "subtask")).toBe(true);
    expect(segments.some((s) => s.kind === "link")).toBe(true);
    expect(segments.some((s) => s.kind === "recurring")).toBe(true);
    expect(segments.some((s) => s.kind === "title" && s.text.startsWith("$"))).toBe(true);
    expect(segments.some((s) => s.kind === "priority")).toBe(true);
  });

  it("should parse numeric priority levels", () => {
    expect(parseQuickTask("Task !1").priority).toBe("level:1");
    expect(parseQuickTask("Task !3").priority).toBe("level:3");
  });

  it("resolves numeric priority levels to configured IDs", () => {
    const priorities = [
      { id: "high", level: 1, label: "High" },
      { id: "medium", level: 2, label: "Medium" },
      { id: "low", level: 3, label: "Low" },
    ];
    expect(resolveParsedPriority("level:1", priorities)).toBe("high");
    expect(resolveParsedPriority("level:3", priorities)).toBe("low");
    expect(resolveParsedPriority("high", priorities)).toBe("high");
  });

  it("finds duplicate task titles case-insensitively", () => {
    const matches = findDuplicateTaskTitles("Fix Bug", [
      { title: "fix bug" },
      { title: "Other task" },
    ]);
    expect(matches).toEqual(["fix bug"]);
  });

  it("finds similar task titles with normalized fuzzy matching", () => {
    const matches = findSimilarTaskTitles("Fix login bug", [
      { title: "fix login-bug" },
      { title: "Deploy release" },
      { title: "Fix login bugs" },
    ]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].title).toMatch(/fix login/i);
    expect(matches[0].score).toBeGreaterThanOrEqual(SIMILAR_TITLE_THRESHOLD);
  });

  it("avoids false-positive similar matches at the tuned threshold", () => {
    const unrelated = findSimilarTaskTitles("Implement auth flow", [
      { title: "Implement caching layer" },
      { title: "Deploy release" },
    ]);
    expect(unrelated).toEqual([]);

    const shortPartial = findSimilarTaskTitles("Review", [
      { title: "Review quarterly roadmap document" },
    ]);
    expect(shortPartial).toEqual([]);
  });

  it("uses SIMILAR_TITLE_THRESHOLD as the default cutoff", () => {
    expect(SIMILAR_TITLE_THRESHOLD).toBe(0.68);
  });

  it("normalizes titles for comparison", () => {
    expect(normalizeTaskTitle("  Fix-Login  Bug! ")).toBe("fix login bug");
    expect(titleSimilarityScore("Fix Login Bug", "fix login bug")).toBe(1);
    expect(titleSimilarityScore("Fix login bug", "Deploy release")).toBeLessThan(SIMILAR_TITLE_THRESHOLD);
  });

  it("suggests metadata from a single recent quick-add entry", () => {
    const suggestion = suggestQuickAddMetadata(["$Ship release !h #work +urgent @tom"]);
    expect(suggestion).toContain("!h");
    expect(suggestion).toContain("#work");
    expect(suggestion).toContain("+urgent");
    expect(suggestion).toContain("@tom");
  });

  it("suggests recurring quick-add metadata from history", () => {
    const suggestion = suggestQuickAddMetadata([
      "$Task one !h #work",
      "$Task two !h #work",
      "$Task three !m #work",
    ]);
    expect(suggestion).toContain("!h");
    expect(suggestion).toContain("#work");
  });

  it("exports and imports quick-add templates", () => {
    const exported = exportQuickAddTemplates(["$Task one !h", "$Task two !m"]);
    const imported = importQuickAddTemplates(exported);
    expect(imported).toEqual(["$Task one !h", "$Task two !m"]);
    expect(importQuickAddTemplates("$Line one\n$Line two")).toEqual(["$Line one", "$Line two"]);
  });

  it("extracts file paths from pasted clipboard text", () => {
    expect(extractFilePathsFromPaste("src/auth/login.ts")).toEqual(["src/auth/login.ts"]);
    expect(extractFilePathsFromPaste("@src/auth/login.ts\nREADME.md")).toEqual([
      "src/auth/login.ts",
      "README.md",
    ]);
    expect(extractFilePathsFromPaste("plain notes")).toEqual([]);
  });

  it("scores fuzzy completion matches", () => {
    expect(fuzzyCompletionScore("Project Alpha", "proj")).toBeGreaterThan(0);
    expect(fuzzyCompletionScore("Project Alpha", "zzz")).toBe(0);
  });

  it("returns a safe fallback when parsing throws", () => {
    const broken = { toString: () => { throw new Error("boom"); } } as unknown as string;
    const result = safeParseQuickTask(broken);
    expect(result.warnings.some((w) => w.code === "parse_error")).toBe(true);
  });
});
