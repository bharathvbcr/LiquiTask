// Enhanced natural language parsing for quick task entry

export interface ParseWarning {
  code: string;
  message: string;
}

export interface ParsedTask {
  title: string;
  priority?: string;
  dueDate?: Date;
  projectName?: string;
  timeEstimate?: number; // in minutes
  tags: string[];
  assignee?: string;
  /** Paths or filenames linked via @path/to/file.ts (distinct from @today date tokens). */
  filePaths: string[];
  /** True when the title came from an explicit $title token. */
  usedExplicitTitle: boolean;
  /** Non-fatal issues detected while parsing (invalid tokens, ambiguous markers). */
  warnings: ParseWarning[];
}

export type QuickAddCompletionKind = "date" | "column" | "project" | "file" | "assignee";

export interface QuickAddCompletion {
  kind: QuickAddCompletionKind;
  value: string;
  label: string;
}

export type QuickAddTokenKind =
  | "text"
  | "title"
  | "priority"
  | "date"
  | "file"
  | "project"
  | "tag"
  | "assignee"
  | "estimate";

export interface QuickAddTokenSegment {
  text: string;
  kind: QuickAddTokenKind;
}

/**
 * Minimum `titleSimilarityScore` for fuzzy duplicate warnings.
 * Slightly above 0.65 to reduce false positives on partial substring matches.
 */
export const SIMILAR_TITLE_THRESHOLD = 0.68;

/** Score how well `text` matches a completion fragment (higher = better). */
export function fuzzyCompletionScore(text: string, fragment: string): number {
  const textLower = text.toLowerCase();
  const fragmentLower = fragment.toLowerCase();
  if (!fragmentLower) return 1;
  if (textLower === fragmentLower) return 100;
  if (textLower.startsWith(fragmentLower)) return 80;
  if (textLower.includes(fragmentLower)) return 60;

  let queryIndex = 0;
  let score = 0;
  for (let i = 0; i < textLower.length && queryIndex < fragmentLower.length; i++) {
    if (textLower[i] === fragmentLower[queryIndex]) {
      score += 1;
      queryIndex++;
    }
  }
  return queryIndex === fragmentLower.length ? 20 + score : 0;
}


const VALID_ESTIMATE_PATTERN = /^(?:\d+h\d+m|\d+(?:\.\d+)?[hm])$/i;

// Weekday names (and common short forms) mapped to their day index (0 = Sunday).
const WEEKDAYS: Array<{ pattern: RegExp; day: number }> = [
  { pattern: /@(sunday|sun)\b/i, day: 0 },
  { pattern: /@(monday|mon)\b/i, day: 1 },
  { pattern: /@(tuesday|tues|tue)\b/i, day: 2 },
  { pattern: /@(wednesday|wed)\b/i, day: 3 },
  { pattern: /@(thursday|thurs|thur|thu)\b/i, day: 4 },
  { pattern: /@(friday|fri)\b/i, day: 5 },
  { pattern: /@(saturday|sat)\b/i, day: 6 },
];

const DATE_AT_TOKEN =
  /^(today|tod|tomorrow|tom|next\s*week|\+(\d+)([dwm])|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)$/i;

// Strip the time-of-day component so date comparisons happen at day granularity.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isRelativeDateAtToken(token: string): boolean {
  return /^\+(\d+)([dwm])$/i.test(token);
}

function resolveRelativeDate(token: string, today: Date): Date | undefined {
  const match = token.match(/^\+(\d+)([dwm])$/i);
  if (!match) return undefined;
  const amount = parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2].toLowerCase();
  const dueDate = new Date(today);
  if (unit === "d") {
    dueDate.setDate(today.getDate() + amount);
  } else if (unit === "w") {
    dueDate.setDate(today.getDate() + amount * 7);
  } else if (unit === "m") {
    dueDate.setMonth(today.getMonth() + amount);
  }
  return dueDate;
}

function isDateAtToken(token: string): boolean {
  return (
    DATE_AT_TOKEN.test(token) ||
    isRelativeDateAtToken(token) ||
    /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(token)
  );
}

function looksLikeFilePath(token: string): boolean {
  return token.includes(".") || token.includes("/") || token.includes("\\");
}

/** Pull an explicit title from `$"quoted"` or `$Title Here` tokens. */
function parseExplicitTitle(input: string): { text: string; explicitTitle?: string } {
  const quoted = input.match(/(?:^|\s)\$"([^"]+)"/);
  if (quoted) {
    return {
      explicitTitle: quoted[1].trim(),
      text: input.replace(quoted[0], " "),
    };
  }

  const unquoted = input.match(
    /(?:^|\s)\$([^\s!#+~>@$]+(?:\s+(?![!#+~>@$])[^\s!#+~>@$]+)*)/,
  );
  if (unquoted) {
    return {
      explicitTitle: unquoted[1].trim(),
      text: input.replace(unquoted[0], " "),
    };
  }

  return { text: input };
}

/** Extract @file/path tokens before date parsing consumes @ tokens. */
function parseFilePaths(input: string): { text: string; filePaths: string[] } {
  const filePaths: string[] = [];
  let text = input;

  for (const match of input.matchAll(/(?:^|\s)@([\w./\\-]+)/g)) {
    const token = match[1];
    if (isDateAtToken(token) || !looksLikeFilePath(token)) continue;
    filePaths.push(token);
    text = text.replace(match[0], " ");
  }

  return { text, filePaths };
}

function isWeekdayAtToken(token: string): boolean {
  return WEEKDAYS.some(({ pattern }) => pattern.test(`@${token}`));
}

/** Collect parse-time warnings for invalid or ambiguous tokens. */
export function collectParseWarnings(
  originalInput: string,
  parsed: Omit<ParsedTask, "warnings">,
): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const seen = new Set<string>();

  const pushWarning = (code: string, message: string) => {
    const key = `${code}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({ code, message });
  };

  for (const match of originalInput.matchAll(
    /(?:^|\s)!(?!(?:high|h|medium|med|m|low|l|\d+)\b)(\w+)/gi,
  )) {
    pushWarning(
      "invalid_priority",
      `Unknown priority "!${match[1]}" — use !h, !m, !l, or !1–!5 for level.`,
    );
  }

  for (const match of originalInput.matchAll(/(?:^|\s)~(\S+)/g)) {
    if (!VALID_ESTIMATE_PATTERN.test(match[1])) {
      pushWarning(
        "invalid_estimate",
        `Invalid estimate "~${match[1]}" — use ~2h, ~30m, or ~1h30m.`,
      );
    }
  }

  if (/(?:^|\s)\$""/.test(originalInput)) {
    pushWarning("empty_title", 'Provide a title inside $"..." or after $.');
  }

  for (const match of originalInput.matchAll(/(?:^|\s)@([\w./\\-]+)/g)) {
    const token = match[1];
    if (isDateAtToken(token) || isWeekdayAtToken(token)) continue;
    if (looksLikeFilePath(token) && parsed.filePaths.includes(token)) continue;
    if (!looksLikeFilePath(token) && !isDateAtToken(token)) {
      pushWarning(
        "unknown_at_token",
        `"@${token}" is not a recognized date or file path.`,
      );
    }
  }

  for (const match of originalInput.matchAll(/@(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      pushWarning(
        "invalid_date",
        `Invalid date "@${match[1]}/${match[2]}${match[3] ? `/${match[3]}` : ""}" — check month/day values.`,
      );
    } else if (!parsed.dueDate) {
      pushWarning(
        "invalid_date",
        `Could not resolve date "@${match[1]}/${match[2]}${match[3] ? `/${match[3]}` : ""}".`,
      );
    }
  }

  if (parsed.usedExplicitTitle && !parsed.title.trim()) {
    pushWarning("empty_title", "Explicit $ title is empty.");
  }

  return warnings;
}

const DATE_COMPLETIONS: QuickAddCompletion[] = [
  { kind: "date", value: "@today", label: "Today" },
  { kind: "date", value: "@tom", label: "Tomorrow" },
  { kind: "date", value: "@+3d", label: "In 3 days" },
  { kind: "date", value: "@+1w", label: "In 1 week" },
  { kind: "date", value: "@next week", label: "Next week" },
  { kind: "date", value: "@mon", label: "Monday" },
  { kind: "date", value: "@fri", label: "Friday" },
];

/** Suggest completions when the caret is on an active @, >, or # token. */
export function getQuickAddCompletions(
  input: string,
  cursor: number,
  context: {
    columns?: Array<{ id: string; title: string }>;
    projects?: Array<{ id: string; name: string }>;
    workspaceFiles?: string[];
    assignees?: string[];
  },
): QuickAddCompletion[] {
  const before = input.slice(0, cursor);
  const atMatch = before.match(/(?:^|\s)@([\w./\\-]*)$/);
  if (atMatch) {
    const fragment = atMatch[1].toLowerCase();
    const looksLikeFile =
      fragment.includes(".") || fragment.includes("/") || fragment.includes("\\");

    if (looksLikeFile && context.workspaceFiles?.length) {
      return context.workspaceFiles
        .map((path) => ({
          path,
          score: fuzzyCompletionScore(path, fragment),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ path }) => ({
          kind: "file" as const,
          value: `@${path}`,
          label: path.split(/[\\/]/).pop() || path,
        }));
    }

    if (looksLikeFile) return [];

    return DATE_COMPLETIONS.filter(
      (c) =>
        fuzzyCompletionScore(c.value.slice(1), fragment) > 0 ||
        fuzzyCompletionScore(c.label, fragment) > 0,
    ).sort(
      (a, b) =>
        fuzzyCompletionScore(b.value.slice(1), fragment) -
        fuzzyCompletionScore(a.value.slice(1), fragment),
    );
  }

  const assigneeMatch = before.match(/(?:^|\s)>([a-zA-Z0-9_.-]*)$/);
  if (assigneeMatch) {
    const fragment = assigneeMatch[1].toLowerCase();
    const columnMatches = (context.columns ?? [])
      .map((c) => ({
        kind: "column" as const,
        value: `>${c.title}`,
        label: c.title,
        score: fuzzyCompletionScore(c.title, fragment),
      }))
      .filter(({ score }) => score > 0);

    const assigneeMatches = (context.assignees ?? [])
      .filter((name) => !columnMatches.some((c) => c.label.toLowerCase() === name.toLowerCase()))
      .map((name) => ({
        kind: "assignee" as const,
        value: `>${name}`,
        label: name,
        score: fuzzyCompletionScore(name, fragment),
      }))
      .filter(({ score }) => score > 0);

    return [...columnMatches, ...assigneeMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ kind, value, label }) => ({ kind, value, label }));
  }

  const projectMatch = before.match(/#([a-zA-Z0-9_-]*)$/);
  if (projectMatch) {
    const fragment = projectMatch[1].toLowerCase();
    return (context.projects ?? [])
      .map((p) => ({
        project: p,
        score: Math.max(
          fuzzyCompletionScore(p.name, fragment),
          fuzzyCompletionScore(p.name.replace(/\s+/g, ""), fragment),
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ project }) => ({
        kind: "project" as const,
        value: `#${project.name.replace(/\s+/g, "")}`,
        label: project.name,
      }));
  }

  return [];
}

/** Whether the input uses quick-add command syntax (vs plain prose for AI refine/extract). */
export function hasQuickAddSyntax(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  if (/(?:^|\s)\$/.test(trimmed)) return true;

  const parsed = parseQuickTask(trimmed);
  return Boolean(
    parsed.usedExplicitTitle ||
      parsed.priority ||
      parsed.dueDate ||
      parsed.projectName ||
      parsed.timeEstimate ||
      parsed.tags.length ||
      parsed.assignee ||
      parsed.filePaths.length,
  );
}

/** Parse quick-add input; on unexpected failure return plain-text fallback with a warning. */
export function safeParseQuickTask(input: string): ParsedTask {
  try {
    return parseQuickTask(input);
  } catch {
    let trimmed = "";
    try {
      trimmed = typeof input === "string" ? input.trim() : String(input).trim();
    } catch {
      trimmed = "";
    }
    return {
      title: trimmed,
      tags: [],
      filePaths: [],
      usedExplicitTitle: false,
      warnings: [
        {
          code: "parse_error",
          message: "Could not parse quick-add syntax; using plain text.",
        },
      ],
    };
  }
}

export function parseQuickTask(input: string): ParsedTask {
  const { explicitTitle, text: afterExplicitTitle } = parseExplicitTitle(input);
  const { filePaths, text: afterFiles } = parseFilePaths(afterExplicitTitle);

  let title = afterFiles;
  let priority: string | undefined;
  let dueDate: Date | undefined;
  let projectName: string | undefined;
  let timeEstimate: number | undefined;
  let assignee: string | undefined;
  const tags: string[] = [];

  // Parse assignee (>name) — e.g. ">devin" hands the task to an agent teammate.
  const assigneeMatch = title.match(/(?:^|\s)>([a-zA-Z0-9_.-]+)\b/);
  if (assigneeMatch) {
    assignee = assigneeMatch[1];
    title = title.replace(assigneeMatch[0], " ");
  }

  // Parse priority markers (!h, !m, !l, !high, !medium, !low, !1–!9 by level)
  if (title.match(/!(high|h)\b/i)) {
    priority = "high";
    title = title.replace(/!(high|h)\b/gi, "");
  } else if (title.match(/!(medium|med|m)\b/i)) {
    priority = "medium";
    title = title.replace(/!(medium|med|m)\b/gi, "");
  } else if (title.match(/!(low|l)\b/i)) {
    priority = "low";
    title = title.replace(/!(low|l)\b/gi, "");
  } else {
    const numericPriorityMatch = title.match(/!(?:p)?(\d+)\b/i);
    if (numericPriorityMatch) {
      priority = `level:${numericPriorityMatch[1]}`;
      title = title.replace(numericPriorityMatch[0], "");
    }
  }

  // Parse project (#projectname)
  const projectMatch = title.match(/#([a-zA-Z0-9_-]+)/);
  if (projectMatch) {
    projectName = projectMatch[1];
    title = title.replace(projectMatch[0], "");
  }

  // Parse time estimate (~2h, ~30m, ~1.5h, ~1h30m)
  const combinedTimeMatch = title.match(/~(\d+)h(\d+)m\b/i);
  const timeMatch = title.match(/~(\d+(?:\.\d+)?)(h|m)\b/i);
  if (combinedTimeMatch) {
    const hVal = parseInt(combinedTimeMatch[1], 10);
    const mVal = parseInt(combinedTimeMatch[2], 10);
    if (mVal <= 59) {
      timeEstimate = hVal * 60 + mVal;
      title = title.replace(combinedTimeMatch[0], "");
    }
  } else if (timeMatch) {
    const value = parseFloat(timeMatch[1]);
    const unit = timeMatch[2].toLowerCase();
    timeEstimate = unit === "h" ? Math.round(value * 60) : Math.round(value); // Convert to minutes
    title = title.replace(timeMatch[0], "");
  }

  // Parse due date patterns before tags so @+3d is not consumed as +3d tag.
  const today = startOfDay(new Date());
  const todayMatch = title.match(/(@today|@tod)\b/i);
  const tomorrowMatch = title.match(/(@tomorrow|@tom)\b/i);
  const nextWeekMatch = title.match(/@next\s*week\b/i);
  const relativeDateMatch = title.match(/@\+(\d+)([dwm])\b/i);
  const fullDateMatch = title.match(/@(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // @MM/DD/YYYY
  const dateMatch = title.match(/@(\d{1,2})\/(\d{1,2})/); // @MM/DD format
  const weekday = WEEKDAYS.find(({ pattern }) => pattern.test(title));

  if (todayMatch) {
    dueDate = today;
    title = title.replace(todayMatch[0], "");
  } else if (tomorrowMatch) {
    dueDate = new Date(today);
    dueDate.setDate(today.getDate() + 1);
    title = title.replace(tomorrowMatch[0], "");
  } else if (nextWeekMatch) {
    dueDate = new Date(today);
    dueDate.setDate(today.getDate() + 7);
    title = title.replace(nextWeekMatch[0], "");
  } else if (relativeDateMatch) {
    const resolved = resolveRelativeDate(`+${relativeDateMatch[1]}${relativeDateMatch[2]}`, today);
    if (resolved) {
      dueDate = resolved;
      title = title.replace(relativeDateMatch[0], "");
    }
  } else if (weekday) {
    const match = title.match(weekday.pattern);
    let diff = weekday.day - today.getDay();
    if (diff <= 0) diff += 7;
    dueDate = new Date(today);
    dueDate.setDate(today.getDate() + diff);
    if (match) title = title.replace(match[0], "");
  } else if (fullDateMatch) {
    const month = parseInt(fullDateMatch[1], 10) - 1;
    const day = parseInt(fullDateMatch[2], 10);
    let year = parseInt(fullDateMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      dueDate = new Date(year, month, day);
      if (dueDate.getMonth() !== month) dueDate = undefined;
    }
    title = title.replace(fullDateMatch[0], "");
  } else if (dateMatch) {
    const month = parseInt(dateMatch[1], 10) - 1;
    const day = parseInt(dateMatch[2], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      dueDate = new Date(today.getFullYear(), month, day);
      if (dueDate.getMonth() !== month) {
        dueDate = undefined;
      } else {
        if (startOfDay(dueDate) < today) {
          dueDate.setFullYear(today.getFullYear() + 1);
          if (dueDate.getMonth() !== month) dueDate = undefined;
        }
      }
    }
    title = title.replace(dateMatch[0], "");
  }

  // Parse tags (+tag)
  const tagMatches = title.matchAll(/\+([a-zA-Z0-9_-]+)/g);
  for (const match of tagMatches) {
    tags.push(match[1]);
    title = title.replace(match[0], "");
  }

  // Clean up any extra whitespace
  title = title.replace(/\s+/g, " ").trim();
  const resolvedTitle = explicitTitle || title;

  const result: Omit<ParsedTask, "warnings"> = {
    title: resolvedTitle,
    priority,
    dueDate,
    projectName,
    timeEstimate,
    tags,
    assignee,
    filePaths,
    usedExplicitTitle: Boolean(explicitTitle),
  };

  return {
    ...result,
    warnings: collectParseWarnings(input, result),
  };
}

/** Parse newline-separated quick-add lines (ignores blank lines). */
export function parseMultipleQuickTasks(
  input: string,
  options?: { includeInvalid?: boolean },
): ParsedTask[] {
  const parsed = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseQuickTask(line));
  if (options?.includeInvalid) return parsed;
  return parsed.filter((task) => task.title.trim());
}

export type BatchLineStatus = "ok" | "warning" | "error";

/** Per-line status for multi-line batch preview and Create All validation. */
export function getBatchLineStatus(parsed: ParsedTask): {
  status: BatchLineStatus;
  message?: string;
} {
  if (!parsed.title.trim()) {
    return { status: "error", message: "Missing title" };
  }
  const emptyTitle = parsed.warnings.find((w) => w.code === "empty_title");
  if (emptyTitle) {
    return { status: "error", message: emptyTitle.message };
  }
  const parseError = parsed.warnings.find((w) => w.code === "parse_error");
  if (parseError) {
    return { status: "error", message: parseError.message };
  }
  if (parsed.warnings.length > 0) {
    return { status: "warning", message: parsed.warnings[0].message };
  }
  return { status: "ok" };
}

/** True when any batch line has a blocking parse error. */
export function hasBatchBlockingErrors(parsedTasks: ParsedTask[]): boolean {
  return parsedTasks.some((parsed) => getBatchLineStatus(parsed).status === "error");
}

/** Build a quick-add prefill from the active board project and column. */
export function buildBoardContextQuickAddPrefill(
  projectName?: string,
  columnTitle?: string,
): string {
  const parts = ["$Title"];
  if (projectName?.trim()) {
    parts.push(`#${projectName.trim().replace(/\s+/g, "")}`);
  }
  if (columnTitle?.trim()) {
    parts.push(`>${columnTitle.trim().replace(/\s+/g, "")}`);
  }
  return parts.length > 1 ? parts.join(" ") : "";
}

/** Human-readable summary of a parsed quick-add task (for clipboard copy). */
export function formatParsedTaskSummary(parsed: ParsedTask): string {
  const lines = [`Title: ${parsed.title}`];
  if (parsed.priority) lines.push(`Priority: ${parsed.priority}`);
  if (parsed.dueDate) lines.push(`Due: ${parsed.dueDate.toLocaleDateString()}`);
  if (parsed.projectName) lines.push(`Project: #${parsed.projectName}`);
  if (parsed.timeEstimate) lines.push(`Estimate: ~${parsed.timeEstimate}m`);
  if (parsed.assignee) lines.push(`Assignee: >${parsed.assignee}`);
  if (parsed.tags.length) lines.push(`Tags: ${parsed.tags.map((t) => `+${t}`).join(" ")}`);
  if (parsed.filePaths.length) {
    lines.push(`Files: ${parsed.filePaths.map((p) => `@${p}`).join(" ")}`);
  }
  if (parsed.warnings.length) {
    lines.push(`Warnings: ${parsed.warnings.map((w) => w.message).join("; ")}`);
  }
  return lines.join("\n");
}

/** JSON snapshot of parsed quick-add fields (for clipboard copy). */
export function parsedTaskToJson(parsed: ParsedTask): string {
  return JSON.stringify(
    {
      title: parsed.title,
      priority: parsed.priority ?? null,
      dueDate: parsed.dueDate?.toISOString() ?? null,
      projectName: parsed.projectName ?? null,
      timeEstimate: parsed.timeEstimate ?? null,
      assignee: parsed.assignee ?? null,
      tags: parsed.tags,
      filePaths: parsed.filePaths,
      warnings: parsed.warnings,
    },
    null,
    2,
  );
}

const QUICK_ADD_TOKEN_PATTERN =
  /(\$"[^"]+"|\$[^\s!#+~>@$]+(?:\s+(?![!#+~>@$])[^\s!#+~>@$]+)*|![a-z]+|@[\w./\\-]+|#[\w-]+|\+[\w-]+|>[\w.-]+|~[\d.hm]+)/gi;

function classifyQuickAddToken(token: string): QuickAddTokenKind {
  if (token.startsWith("$")) return "title";
  if (token.startsWith("!")) return "priority";
  if (token.startsWith("@")) {
    const inner = token.slice(1);
    if (
      isDateAtToken(inner) ||
      isWeekdayAtToken(inner) ||
      isRelativeDateAtToken(inner) ||
      /^@?\d{1,2}\/\d{1,2}/.test(token) ||
      /^@?\+(\d+)([dwm])$/i.test(token)
    ) {
      return "date";
    }
    if (looksLikeFilePath(inner)) return "file";
    return "date";
  }
  if (token.startsWith("#")) return "project";
  if (token.startsWith("+")) return "tag";
  if (token.startsWith(">")) return "assignee";
  if (token.startsWith("~")) return "estimate";
  return "text";
}

/** Map parsed priority (h/m/l id or level:N) to a configured board priority ID. */
export function resolveParsedPriority(
  parsedPriority: string | undefined,
  priorities: Array<{ id: string; level: number; label?: string }>,
  fallback?: string,
): string | undefined {
  if (!parsedPriority) return fallback;
  if (parsedPriority.startsWith("level:")) {
    const level = parseInt(parsedPriority.slice(6), 10);
    if (!Number.isFinite(level)) return fallback;
    const byLevel = priorities.find((p) => p.level === level);
    if (byLevel) return byLevel.id;
    const sorted = [...priorities].sort((a, b) => a.level - b.level);
    if (level >= 1 && level <= sorted.length) return sorted[level - 1]?.id;
    return fallback;
  }
  if (priorities.some((p) => p.id === parsedPriority)) return parsedPriority;
  const byLabel = priorities.find(
    (p) => p.label?.toLowerCase() === parsedPriority.toLowerCase(),
  );
  return byLabel?.id ?? parsedPriority;
}

/** Normalize a title for fuzzy comparison (case, whitespace, punctuation). */
export function normalizeTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokenSet(title: string): Set<string> {
  return new Set(normalizeTaskTitle(title).split(" ").filter(Boolean));
}

function tokenJaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Score how similar two task titles are after normalization (0–1). */
export function titleSimilarityScore(a: string, b: string): number {
  const normA = normalizeTaskTitle(a);
  const normB = normalizeTaskTitle(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  if (normA.includes(normB) || normB.includes(normA)) {
    const shorter = Math.min(normA.length, normB.length);
    const longer = Math.max(normA.length, normB.length);
    return (shorter / longer) * 0.92;
  }

  return tokenJaccardSimilarity(titleTokenSet(a), titleTokenSet(b));
}

/** Find existing tasks whose title exactly matches (case-insensitive). */
export function findDuplicateTaskTitles(
  title: string,
  tasks: Array<{ title: string }>,
): string[] {
  const needle = title.trim().toLowerCase();
  if (!needle) return [];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const task of tasks) {
    if (task.title.trim().toLowerCase() !== needle) continue;
    const key = task.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(task.title);
  }
  return matches;
}

/** Find tasks with similar titles (normalized fuzzy match, excluding exact duplicates). */
export function findSimilarTaskTitles(
  title: string,
  tasks: Array<{ title: string }>,
  options?: { threshold?: number; limit?: number },
): Array<{ title: string; score: number }> {
  const threshold = options?.threshold ?? SIMILAR_TITLE_THRESHOLD;
  const limit = options?.limit ?? 3;
  const needle = title.trim();
  if (!needle) return [];

  const exactMatches = new Set(
    findDuplicateTaskTitles(needle, tasks).map((t) => t.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const matches: Array<{ title: string; score: number }> = [];

  for (const task of tasks) {
    const key = task.title.trim().toLowerCase();
    if (!key || exactMatches.has(key) || seen.has(key)) continue;

    const score = titleSimilarityScore(needle, task.title);
    if (score < threshold) continue;

    seen.add(key);
    matches.push({ title: task.title, score });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

const QUICK_ADD_METADATA_TOKEN =
  /(?:^|\s)(![\w]+|#[\w-]+|\+[\w-]+|~[\d.hm]+|@[\w./\\-]+|>[\w.-]+)/g;

/** Suggest recurring metadata tokens from recent quick-add history (e.g. "!h #work"). */
export function suggestQuickAddMetadata(recentEntries: string[]): string {
  if (!recentEntries.length) return "";

  const tokenCounts = new Map<string, number>();
  for (const entry of recentEntries) {
    const tokens = new Set<string>();
    for (const match of entry.matchAll(QUICK_ADD_METADATA_TOKEN)) {
      tokens.add(match[1].trim());
    }
    for (const token of tokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }

  if (recentEntries.length === 1) {
    return [...tokenCounts.keys()].join(" ");
  }

  const threshold = Math.max(2, Math.ceil(recentEntries.length * 0.5));
  return [...tokenCounts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .join(" ");
}

/** Serialize recent quick-add templates for export. */
export function exportQuickAddTemplates(recentEntries: string[]): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: recentEntries,
    },
    null,
    2,
  );
}

/** Parse imported quick-add templates from JSON or newline-separated text. */
export function importQuickAddTemplates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as { templates?: unknown };
    if (Array.isArray(parsed.templates)) {
      return parsed.templates
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // Fall through to plain-text import.
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Extract file-like paths from pasted clipboard text. */
export function extractFilePathsFromPaste(text: string): string[] {
  const candidates = text
    .split(/[\r\n]+/)
    .flatMap((line) => line.split(/\s+/))
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  const paths = candidates
    .map((part) => part.replace(/^@/, ""))
    .filter((part) => looksLikeFilePath(part));

  if (paths.length > 0) return paths;

  const single = text.trim().replace(/^@/, "");
  return looksLikeFilePath(single) ? [single] : [];
}

/** Split quick-add input into syntax-colored segments for preview highlighting. */
export function segmentQuickAddInput(input: string): QuickAddTokenSegment[] {
  if (!input) return [];

  const segments: QuickAddTokenSegment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(QUICK_ADD_TOKEN_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, index), kind: "text" });
    }
    segments.push({ text: token, kind: classifyQuickAddToken(token) });
    lastIndex = index + token.length;
  }

  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), kind: "text" });
  }

  return segments.length ? segments : [{ text: input, kind: "text" }];
}
