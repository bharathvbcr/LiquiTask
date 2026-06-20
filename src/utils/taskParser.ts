// Enhanced natural language parsing for quick task entry

export interface ParsedTask {
  title: string;
  priority?: string;
  dueDate?: Date;
  projectName?: string;
  timeEstimate?: number; // in minutes
  tags: string[];
}

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

// Strip the time-of-day component so date comparisons happen at day granularity.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseQuickTask(input: string): ParsedTask {
  let title = input;
  let priority: string | undefined;
  let dueDate: Date | undefined;
  let projectName: string | undefined;
  let timeEstimate: number | undefined;
  const tags: string[] = [];

  // Parse priority markers (!h, !m, !l, !high, !medium, !low)
  if (input.match(/!(high|h)\b/i)) {
    priority = "high";
    title = title.replace(/!(high|h)\b/gi, "");
  } else if (input.match(/!(medium|med|m)\b/i)) {
    priority = "medium";
    title = title.replace(/!(medium|med|m)\b/gi, "");
  } else if (input.match(/!(low|l)\b/i)) {
    priority = "low";
    title = title.replace(/!(low|l)\b/gi, "");
  }

  // Parse project (#projectname)
  const projectMatch = input.match(/#([a-zA-Z0-9_-]+)/);
  if (projectMatch) {
    projectName = projectMatch[1];
    title = title.replace(projectMatch[0], "");
  }

  // Parse time estimate (~2h, ~30m, ~1.5h, ~1h30m)
  const combinedTimeMatch = input.match(/~(\d+)h(\d+)m\b/i);
  const timeMatch = input.match(/~(\d+(?:\.\d+)?)(h|m)\b/i);
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

  // Parse tags (+tag)
  const tagMatches = input.matchAll(/\+([a-zA-Z0-9_-]+)/g);
  for (const match of tagMatches) {
    tags.push(match[1]);
    title = title.replace(match[0], "");
  }

  // Parse due date patterns. Order matters: relative keywords, then weekdays,
  // then explicit @MM/DD and @MM/DD/YYYY formats.
  const today = startOfDay(new Date());
  const todayMatch = input.match(/(@today|@tod)\b/i);
  const tomorrowMatch = input.match(/(@tomorrow|@tom)\b/i);
  const nextWeekMatch = input.match(/@next\s*week\b/i);
  const fullDateMatch = input.match(/@(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // @MM/DD/YYYY
  const dateMatch = input.match(/@(\d{1,2})\/(\d{1,2})/); // @MM/DD format
  const weekday = WEEKDAYS.find(({ pattern }) => pattern.test(input));

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
  } else if (weekday) {
    // Resolve to the next upcoming occurrence of the named weekday. If today is
    // that weekday, interpret it as the same day next week (use @today for today).
    const match = input.match(weekday.pattern);
    let diff = weekday.day - today.getDay();
    if (diff <= 0) diff += 7;
    dueDate = new Date(today);
    dueDate.setDate(today.getDate() + diff);
    if (match) title = title.replace(match[0], "");
  } else if (fullDateMatch) {
    const month = parseInt(fullDateMatch[1], 10) - 1;
    const day = parseInt(fullDateMatch[2], 10);
    let year = parseInt(fullDateMatch[3], 10);
    if (year < 100) year += 2000; // normalize 2-digit years
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

  // Clean up any extra whitespace
  title = title.replace(/\s+/g, " ").trim();

  return { title, priority, dueDate, projectName, timeEstimate, tags };
}
