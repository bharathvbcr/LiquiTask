// Enhanced natural language parsing for quick task entry

export interface ParseWarning {
  code: string;
  message: string;
}

export interface ParsedTask {
  title: string;
  /** Body text after a :: or --- separator. */
  description?: string;
  priority?: string;
  dueDate?: Date;
  projectName?: string;
  timeEstimate?: number; // in minutes
  tags: string[];
  assignee?: string;
  /** Paths or filenames linked via @path/to/file.ts (distinct from @today date tokens). */
  filePaths: string[];
  /** Subtask titles from >>Title tokens. */
  subtaskTitles: string[];
  /** External URLs from &url tokens or bare https:// links. */
  links: string[];
  /** Recurring frequency from *daily / *weekly / *monthly tokens. */
  recurringFrequency?: "daily" | "weekly" | "monthly";
  /** Interval for recurring (e.g. *weekly2 → 2). */
  recurringInterval?: number;
  /** True when the title came from an explicit $title token. */
  usedExplicitTitle: boolean;
  /** Non-fatal issues detected while parsing (invalid tokens, ambiguous markers). */
  warnings: ParseWarning[];
}

export type QuickAddCompletionKind = "date" | "column" | "project" | "file" | "assignee" | "agent";

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
  | "agent"
  | "estimate"
  | "link"
  | "recurring"
  | "subtask";

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

const EOD_HOUR = 17;

const DATE_AT_TOKEN =
  /^(today|tod|tomorrow|tom|next\s*week|eod|end\s*of\s*day|in\s+\d+\s+days?|in\s+\d+\s+weeks?|next\s+(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)|\+(\d+)([dwm])|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)$/i;

// Strip the time-of-day component so date comparisons happen at day granularity.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isRelativeDateAtToken(token: string): boolean {
  return /^\+(\d+)([dwm])$/i.test(token) || /^in\s+\d+\s+(?:days?|weeks?)$/i.test(token);
}

function isTimeAtToken(token: string): boolean {
  return /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.test(token);
}

function applyDueTime(date: Date, hours: number, minutes = 0): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** Parse @5pm / @9:30am style tokens into 24h clock parts. */
export function parseTimeAtToken(token: string): { hours: number; minutes: number } | undefined {
  const match = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return undefined;
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  if (!Number.isFinite(hours) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return undefined;
  }
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (!meridiem && hours <= 12 && token.includes("pm")) hours += 12;
  return { hours, minutes };
}

/** Format a due date for the task form (date-only or datetime-local). */
export function formatDueDateForForm(date: Date): string {
  const atMidnight =
    date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  if (atMidnight) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

/** Parse a form due-date value (YYYY-MM-DD or YYYY-MM-DDTHH:mm). */
export function parseFormDueDate(value: string): Date | undefined {
  if (!value.trim()) return undefined;
  if (value.includes("T")) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const [y, m, d] = value.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  return new Date(y, m - 1, d);
}

function resolveNextWeekday(dayIndex: number, today: Date): Date {
  let diff = dayIndex - today.getDay();
  if (diff <= 0) diff += 7;
  const dueDate = new Date(today);
  dueDate.setDate(today.getDate() + diff);
  return dueDate;
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
    isTimeAtToken(token) ||
    /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(token)
  );
}

function looksLikeFilePath(token: string): boolean {
  return token.includes(".") || token.includes("/") || token.includes("\\");
}

/** Split description body from metadata line via :: or ---. */
function parseDescription(input: string): { text: string; description?: string } {
  const sepMatch = input.match(/(?:^|\s)(?:::|---)\s+([\s\S]+)/);
  if (!sepMatch) return { text: input };
  return {
    description: sepMatch[1].trim(),
    text: input.replace(sepMatch[0], " ").trim(),
  };
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
    /(?:^|\s)\$([^\s!#+~>@$%]+(?:\s+(?![!#+~>@$%])[^\s!#+~>@$%]+)*)/,
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

  for (const match of input.matchAll(/(?:^|\s)@([\w./-]+)/g)) {
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

  for (const match of originalInput.matchAll(/(?:^|\s)@([\w./-]+)/g)) {
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
  { kind: "date", value: "@tomorrow", label: "Tomorrow" },
  { kind: "date", value: "@eod", label: "End of day (5pm)" },
  { kind: "date", value: "@5pm", label: "Today at 5pm" },
  { kind: "date", value: "@+3d", label: "In 3 days" },
  { kind: "date", value: "@in 3 days", label: "In 3 days" },
  { kind: "date", value: "@+1w", label: "In 1 week" },
  { kind: "date", value: "@next week", label: "Next week" },
  { kind: "date", value: "@next monday", label: "Next Monday" },
  { kind: "date", value: "@mon", label: "Monday" },
  { kind: "date", value: "@fri", label: "Friday" },
];

const RECENCY_BOOST = 25;

function recencyBoost(value: string, recency?: Record<string, number>): number {
  if (!recency) return 0;
  const key = value.toLowerCase();
  const rank = recency[key];
  if (rank === undefined) return 0;
  return RECENCY_BOOST - Math.min(rank, RECENCY_BOOST - 1);
}

/** Suggest completions when the caret is on an active @, >, or # token. */
export function getQuickAddCompletions(
  input: string,
  cursor: number,
  context: {
    columns?: Array<{ id: string; title: string }>;
    projects?: Array<{ id: string; name: string }>;
    workspaceFiles?: string[];
    assignees?: string[];
    agents?: string[];
    completionRecency?: Record<string, number>;
  },
): QuickAddCompletion[] {
  const before = input.slice(0, cursor);
  const atMatch = before.match(/(?:^|\s)@([\w./-]*)$/);
  if (atMatch) {
    const fragment = atMatch[1].toLowerCase();
    const looksLikeFile =
      fragment.includes(".") || fragment.includes("/") || fragment.includes("\\");

    if (looksLikeFile && context.workspaceFiles?.length) {
      return context.workspaceFiles
        .map((path) => ({
          path,
          score:
            fuzzyCompletionScore(path, fragment) +
            recencyBoost(`@${path}`, context.completionRecency),
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
        score:
          fuzzyCompletionScore(c.title, fragment) +
          recencyBoost(`>${c.title}`, context.completionRecency),
      }))
      .filter(({ score }) => score > 0);

    const assigneeMatches = (context.assignees ?? [])
      .filter((name) => !columnMatches.some((c) => c.label.toLowerCase() === name.toLowerCase()))
      .map((name) => ({
        kind: "assignee" as const,
        value: `>${name}`,
        label: name,
        score:
          fuzzyCompletionScore(name, fragment) +
          recencyBoost(`>${name}`, context.completionRecency),
      }))
      .filter(({ score }) => score > 0);

    return [...columnMatches, ...assigneeMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ kind, value, label }) => ({ kind, value, label }));
  }

  const agentMatch = before.match(/(?:^|\s)%([a-zA-Z0-9_.-]*)$/);
  if (agentMatch) {
    const fragment = agentMatch[1].toLowerCase();
    return (context.agents ?? [])
      .map((name) => ({
        kind: "agent" as const,
        value: `%${name}`,
        label: name,
        score:
          fuzzyCompletionScore(name, fragment) +
          recencyBoost(`%${name}`, context.completionRecency),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ kind, value, label }) => ({ kind, value, label }));
  }

  const projectMatch = before.match(/#(?:project:)?([a-zA-Z0-9_-]*)$/i);
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
      parsed.description ||
      parsed.priority ||
      parsed.dueDate ||
      parsed.projectName ||
      parsed.timeEstimate ||
      parsed.tags.length ||
      parsed.assignee ||
      parsed.filePaths.length ||
      parsed.subtaskTitles.length ||
      parsed.links.length ||
      parsed.recurringFrequency,
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
      subtaskTitles: [],
      links: [],
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

/** Parse >>subtask tokens before single > assignee/column markers. */
function parseSubtaskTitles(input: string): { text: string; subtaskTitles: string[] } {
  const subtaskTitles: string[] = [];
  let text = input;
  for (const match of input.matchAll(
    /(?:^|\s)>>([^\s!#+~>@$%&]+(?:\s+(?![!#+~>@$%&])[^\s!#+~>@$%&]+)*)/g,
  )) {
    const title = match[1].trim();
    if (title) subtaskTitles.push(title);
    text = text.replace(match[0], " ");
  }
  return { text, subtaskTitles };
}

/** Extract &url tokens and bare https:// links. */
function parseLinks(input: string): { text: string; links: string[] } {
  const links: string[] = [];
  let text = input;

  for (const match of input.matchAll(/(?:^|\s)&(\S+)/g)) {
    const url = match[1].replace(/[.,;:!?)]+$/, "");
    if (url) links.push(url);
    text = text.replace(match[0], " ");
  }

  for (const match of input.matchAll(/https?:\/\/[^\s]+/gi)) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    if (url && !links.includes(url)) links.push(url);
    text = text.replace(match[0], " ");
  }

  return { text, links };
}

export function parseQuickTask(input: string): ParsedTask {
  const { description, text: afterDescription } = parseDescription(input);
  const { explicitTitle, text: afterExplicitTitle } = parseExplicitTitle(afterDescription);
  const { filePaths, text: afterFiles } = parseFilePaths(afterExplicitTitle);
  const { links, text: afterLinks } = parseLinks(afterFiles);
  const { subtaskTitles, text: afterSubtasks } = parseSubtaskTitles(afterLinks);

  let title = afterSubtasks;
  let priority: string | undefined;
  let dueDate: Date | undefined;
  let projectName: string | undefined;
  let timeEstimate: number | undefined;
  let assignee: string | undefined;
  const tags: string[] = [];
  let recurringFrequency: ParsedTask["recurringFrequency"];
  let recurringInterval: number | undefined;

  const recurringMatch = title.match(/(?:^|\s)\*(daily|weekly|monthly)(\d+)?\b/i);
  if (recurringMatch) {
    recurringFrequency = recurringMatch[1].toLowerCase() as ParsedTask["recurringFrequency"];
    recurringInterval = recurringMatch[2] ? Math.max(1, parseInt(recurringMatch[2], 10)) : 1;
    title = title.replace(recurringMatch[0], " ");
  }

  // Parse agent teammate (%name) before single-char > assignee/column markers.
  const agentMatch = title.match(/(?:^|\s)%([a-zA-Z0-9_.-]+)\b/);
  if (agentMatch) {
    assignee = agentMatch[1];
    title = title.replace(agentMatch[0], " ");
  }

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

  // Parse project (#projectname or #project:Name)
  const projectExplicitMatch = title.match(/#project:([a-zA-Z0-9_-]+)/i);
  const projectMatch = projectExplicitMatch ?? title.match(/#([a-zA-Z0-9_-]+)/);
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
  const eodMatch = title.match(/@(?:eod|end\s*of\s*day)\b/i);
  const nextWeekMatch = title.match(/@next\s*week\b/i);
  const inDaysMatch = title.match(/@in\s+(\d+)\s+days?\b/i);
  const inWeeksMatch = title.match(/@in\s+(\d+)\s+weeks?\b/i);
  const nextWeekdayMatch = title.match(
    /@next\s+(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/i,
  );
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
  } else if (eodMatch) {
    dueDate = applyDueTime(today, EOD_HOUR);
    title = title.replace(eodMatch[0], "");
  } else if (nextWeekMatch) {
    dueDate = new Date(today);
    dueDate.setDate(today.getDate() + 7);
    title = title.replace(nextWeekMatch[0], "");
  } else if (inDaysMatch) {
    const amount = parseInt(inDaysMatch[1], 10);
    if (Number.isFinite(amount) && amount > 0) {
      dueDate = new Date(today);
      dueDate.setDate(today.getDate() + amount);
      title = title.replace(inDaysMatch[0], "");
    }
  } else if (inWeeksMatch) {
    const amount = parseInt(inWeeksMatch[1], 10);
    if (Number.isFinite(amount) && amount > 0) {
      dueDate = new Date(today);
      dueDate.setDate(today.getDate() + amount * 7);
      title = title.replace(inWeeksMatch[0], "");
    }
  } else if (nextWeekdayMatch) {
    const dayName = nextWeekdayMatch[1].toLowerCase();
    const weekdayDef = WEEKDAYS.find(({ pattern }) =>
      pattern.test(`@${dayName}`),
    );
    if (weekdayDef) {
      dueDate = resolveNextWeekday(weekdayDef.day, today);
      title = title.replace(nextWeekdayMatch[0], "");
    }
  } else if (relativeDateMatch) {
    const resolved = resolveRelativeDate(`+${relativeDateMatch[1]}${relativeDateMatch[2]}`, today);
    if (resolved) {
      dueDate = resolved;
      title = title.replace(relativeDateMatch[0], "");
    }
  } else if (weekday) {
    const match = title.match(weekday.pattern);
    dueDate = resolveNextWeekday(weekday.day, today);
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

  // Time-of-day tokens (@5pm) apply to the resolved due date or default to today.
  const dueTimeMatch = title.match(/@(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (dueTimeMatch) {
    const parsedTime = parseTimeAtToken(
      `${dueTimeMatch[1]}${dueTimeMatch[2] ? `:${dueTimeMatch[2]}` : ""}${dueTimeMatch[3] ?? ""}`,
    );
    if (parsedTime) {
      const base = dueDate ?? today;
      dueDate = applyDueTime(base, parsedTime.hours, parsedTime.minutes);
      title = title.replace(dueTimeMatch[0], "");
    }
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
    description,
    priority,
    dueDate,
    projectName,
    timeEstimate,
    tags,
    assignee,
    filePaths,
    subtaskTitles,
    links,
    recurringFrequency,
    recurringInterval,
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
  if (parsed.dueDate) {
    const hasTime = parsed.dueDate.getHours() !== 0 || parsed.dueDate.getMinutes() !== 0;
    lines.push(
      `Due: ${hasTime ? parsed.dueDate.toLocaleString() : parsed.dueDate.toLocaleDateString()}`,
    );
  }
  if (parsed.description) lines.push(`Description: ${parsed.description}`);
  if (parsed.projectName) lines.push(`Project: #${parsed.projectName}`);
  if (parsed.timeEstimate) lines.push(`Estimate: ~${parsed.timeEstimate}m`);
  if (parsed.assignee) lines.push(`Assignee: >${parsed.assignee}`);
  if (parsed.tags.length) lines.push(`Tags: ${parsed.tags.map((t) => `+${t}`).join(" ")}`);
  if (parsed.filePaths.length) {
    lines.push(`Files: ${parsed.filePaths.map((p) => `@${p}`).join(" ")}`);
  }
  if (parsed.subtaskTitles.length) {
    lines.push(`Subtasks: ${parsed.subtaskTitles.map((t) => `>>${t}`).join(" ")}`);
  }
  if (parsed.links.length) {
    lines.push(`Links: ${parsed.links.map((l) => `&${l}`).join(" ")}`);
  }
  if (parsed.recurringFrequency) {
    lines.push(
      `Recurring: *${parsed.recurringFrequency}${parsed.recurringInterval && parsed.recurringInterval > 1 ? parsed.recurringInterval : ""}`,
    );
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
      description: parsed.description ?? null,
      priority: parsed.priority ?? null,
      dueDate: parsed.dueDate?.toISOString() ?? null,
      projectName: parsed.projectName ?? null,
      timeEstimate: parsed.timeEstimate ?? null,
      assignee: parsed.assignee ?? null,
      tags: parsed.tags,
      filePaths: parsed.filePaths,
      subtaskTitles: parsed.subtaskTitles,
      links: parsed.links,
      recurringFrequency: parsed.recurringFrequency ?? null,
      recurringInterval: parsed.recurringInterval ?? null,
      warnings: parsed.warnings,
    },
    null,
    2,
  );
}

const QUICK_ADD_TOKEN_PATTERN =
  /(\$"[^"]+"|\$[^\s!#+~>@$%]+(?:\s+(?![!#+~>@$%])[^\s!#+~>@$%]+)*|![a-z]+|\*[\w]+\d*|>>[^\s!#+~>@$%&]+(?:\s+(?![!#+~>@$%&])[^\s!#+~>@$%&]+)*|&[^\s]+|https?:\/\/[^\s]+|@[\w./-]+|#(?:project:)?[\w-]+|%[\w.-]+|\+[\w-]+|>[\w.-]+|~[\d.hm]+)/gi;

function classifyQuickAddToken(token: string): QuickAddTokenKind {
  if (token.startsWith("$")) return "title";
  if (token.startsWith("!")) return "priority";
  if (token.startsWith("*")) return "recurring";
  if (token.startsWith(">>")) return "subtask";
  if (token.startsWith("&") || /^https?:\/\//i.test(token)) return "link";
  if (token.startsWith("%")) return "agent";
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
  /(?:^|\s)(![\w]+|#[\w-]+|\+[\w-]+|~[\d.hm]+|@[\w./-]+|>[\w.-]+)/g;

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

export interface TaskQuickAddSource {
  title: string;
  priority?: string;
  assignee?: string;
  status?: string;
  dueDate?: Date;
  tags?: string[];
  timeEstimate?: number;
  summary?: string;
  subtasks?: Array<{ title: string }>;
  attachments?: Array<{ url: string; type?: string }>;
  recurring?: { enabled?: boolean; frequency?: string; interval?: number };
}

export interface TaskToQuickAddContext {
  projectName?: string;
  columnTitle?: string;
  priorityLevel?: number;
  priorityLabel?: string;
}

function formatDueDateToken(date: Date): string {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (target.getTime() === today.getTime()) return "@today";
  if (target.getTime() === tomorrow.getTime()) return "@tom";
  return `@${target.getMonth() + 1}/${target.getDate()}`;
}

function formatPriorityToken(
  priorityId: string | undefined,
  context?: TaskToQuickAddContext,
): string {
  if (!priorityId) return "";
  const label = context?.priorityLabel?.toLowerCase();
  if (label === "high" || priorityId === "high") return "!h";
  if (label === "medium" || priorityId === "medium") return "!m";
  if (label === "low" || priorityId === "low") return "!l";
  if (context?.priorityLevel && context.priorityLevel >= 1) {
    return `!${context.priorityLevel}`;
  }
  return `!${priorityId}`;
}

/** Serialize a task into quick-add syntax for duplicate / template flows. */
export function taskToQuickAddSyntax(
  task: TaskQuickAddSource,
  context?: TaskToQuickAddContext,
): string {
  const parts: string[] = [`$${task.title.trim()}`];

  const priorityToken = formatPriorityToken(task.priority, context);
  if (priorityToken) parts.push(priorityToken);

  if (task.dueDate) parts.push(formatDueDateToken(task.dueDate));

  if (context?.projectName?.trim()) {
    parts.push(`#${context.projectName.trim().replace(/\s+/g, "")}`);
  }

  for (const tag of task.tags ?? []) {
    if (tag.trim()) parts.push(`+${tag.trim()}`);
  }

  if (task.timeEstimate && task.timeEstimate > 0) {
    const hours = Math.floor(task.timeEstimate / 60);
    const mins = task.timeEstimate % 60;
    if (hours > 0 && mins > 0) parts.push(`~${hours}h${mins}m`);
    else if (hours > 0) parts.push(`~${hours}h`);
    else parts.push(`~${task.timeEstimate}m`);
  }

  for (const attachment of task.attachments ?? []) {
    if (attachment.type === "link" && attachment.url.startsWith("http")) {
      parts.push(`&${attachment.url}`);
    } else if (attachment.url && looksLikeFilePath(attachment.url)) {
      parts.push(`@${attachment.url}`);
    }
  }

  const summaryUrls = (task.summary ?? "").match(/https?:\/\/[^\s]+/gi) ?? [];
  for (const url of summaryUrls) {
    if (!parts.some((p) => p.includes(url))) parts.push(`&${url}`);
  }

  if (task.recurring?.enabled && task.recurring.frequency) {
    const interval = task.recurring.interval && task.recurring.interval > 1 ? task.recurring.interval : "";
    parts.push(`*${task.recurring.frequency}${interval}`);
  }

  if (context?.columnTitle?.trim()) {
    parts.push(`>${context.columnTitle.trim().replace(/\s+/g, "")}`);
  } else if (task.assignee?.trim()) {
    parts.push(`>${task.assignee.trim().replace(/\s+/g, "")}`);
  }

  for (const subtask of task.subtasks ?? []) {
    if (subtask.title.trim()) parts.push(`>>${subtask.title.trim()}`);
  }

  return parts.join(" ");
}

/** Bump a completion value to the front of the recency map (max 40 entries). */
export function recordCompletionRecency(
  current: Record<string, number>,
  value: string,
): Record<string, number> {
  const key = value.trim();
  if (!key) return current;
  const next: Record<string, number> = { [key.toLowerCase()]: 0 };
  let rank = 1;
  for (const [entry, _rank] of Object.entries(current)) {
    if (entry === key.toLowerCase()) continue;
    next[entry] = rank;
    rank++;
    if (rank >= 40) break;
  }
  return next;
}

/** Validate parsed quick-add before Create Now / Fill. Returns error message or null. */
export function validateQuickAddParsed(parsed: ParsedTask): string | null {
  if (!parsed.title.trim()) {
    return "Enter a task title ($Title, plain text, or fill the title field).";
  }
  const emptyTitle = parsed.warnings.find((w) => w.code === "empty_title");
  if (emptyTitle) return emptyTitle.message;
  const parseError = parsed.warnings.find((w) => w.code === "parse_error");
  if (parseError) return parseError.message;
  return null;
}

export interface QuickAddSavedTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

/** Build a quick-add prefill from a dead-letter / inbox failure context. */
export function buildDeadLetterQuickAddPrefill(title: string, detail: string): string {
  const safeTitle = title.trim().slice(0, 120) || "Follow up on failed action";
  const safeDetail = detail.trim().replace(/\s+/g, " ").slice(0, 400);
  return safeDetail ? `$${safeTitle} :: ${safeDetail}` : `$${safeTitle}`;
}

/** Parse saved template library from storage JSON. */
export function parseQuickAddLibrary(raw: unknown): QuickAddSavedTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is QuickAddSavedTemplate =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as QuickAddSavedTemplate).id === "string" &&
        typeof (entry as QuickAddSavedTemplate).name === "string" &&
        typeof (entry as QuickAddSavedTemplate).content === "string",
    )
    .map((entry) => ({
      ...entry,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    }));
}

/** Add or update a named template in the library (max 30). */
export function upsertQuickAddTemplate(
  library: QuickAddSavedTemplate[],
  name: string,
  content: string,
): QuickAddSavedTemplate[] {
  const trimmedName = name.trim().slice(0, 40);
  const trimmedContent = content.trim();
  if (!trimmedName || !trimmedContent) return library;
  const existing = library.find((t) => t.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) {
    return [
      { ...existing, content: trimmedContent, createdAt: new Date().toISOString() },
      ...library.filter((t) => t.id !== existing.id),
    ].slice(0, 30);
  }
  const entry: QuickAddSavedTemplate = {
    id: `qat-${Date.now().toString(36)}`,
    name: trimmedName,
    content: trimmedContent,
    createdAt: new Date().toISOString(),
  };
  return [entry, ...library].slice(0, 30);
}

/** Remove a template from the library by id. */
export function removeQuickAddTemplate(
  library: QuickAddSavedTemplate[],
  id: string,
): QuickAddSavedTemplate[] {
  return library.filter((t) => t.id !== id);
}

/** True when the active drag rect overlaps the quick-add drop target (for hover hint). */
export function isDragHoveringQuickAddDropTarget(event: {
  active: { rect: { current: { translated: { left: number; top: number; width: number; height: number } | null } } };
}): boolean {
  return isDragOverQuickAddDropTarget(event);
}

/** True when a drag ended with the card center over the quick-add drop target. */
export function isDragOverQuickAddDropTarget(event: {
  active: { rect: { current: { translated: { left: number; top: number; width: number; height: number } | null } } };
}): boolean {
  const el = document.querySelector("[data-quick-add-drop-target]");
  const translated = event.active.rect.current.translated;
  if (!el || !translated) return false;
  const rect = el.getBoundingClientRect();
  const cx = translated.left + translated.width / 2;
  const cy = translated.top + translated.height / 2;
  return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
}
