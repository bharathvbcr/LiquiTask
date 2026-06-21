// Export Service for LiquiTask
// Provides CSV, JSON, Markdown, and iCal export functionality for tasks

import type {
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  Task,
} from "../../types";

export interface ExportOptions {
  format: "csv" | "json";
  scope: "all" | "filtered";
  columns?: string[];
  includeCompleted?: boolean;
}

interface ExportData {
  tasks: Task[];
  projects: Project[];
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  customFields: CustomFieldDefinition[];
}

// Columns that may contain PII or internal identifiers.
// These are kept available for opt-in use but excluded from the default export.
export const PII_CSV_COLUMNS = ["id", "assignee", "projectId", "createdAt", "updatedAt", "completedAt"] as const;
export type PIIColumn = (typeof PII_CSV_COLUMNS)[number];

// Sanitised default: safe for external sharing.
// Does NOT include internal IDs, assignee names, or audit timestamps.
export const SANITISED_CSV_COLUMNS = [
  "title",
  "subtitle",
  "status",
  "priority",
  "dueDate",
  "timeEstimate",
  "timeSpent",
  "tags",
];

// Full column list (opt-in) — includes PII columns.
// Only use when the user has explicitly requested them.
export const DEFAULT_CSV_COLUMNS = [
  ...SANITISED_CSV_COLUMNS,
  "id",
  "assignee",
  "projectId",
  "createdAt",
  "updatedAt",
  "completedAt",
];

class ExportService {
  // Generate CSV content from tasks
  exportToCSV(
    tasks: Task[],
    columns: string[] = SANITISED_CSV_COLUMNS,
    projectMap?: Map<string, string>,
  ): string {
    const header = columns.map((col) => this.formatColumnHeader(col)).join(",");

    const rows = tasks.map((task) => {
      return columns
        .map((col) => {
          const value = this.getTaskValue(task, col, projectMap);
          return this.escapeCSV(value);
        })
        .join(",");
    });

    return [header, ...rows].join("\n");
  }

  // Format column header for display
  private formatColumnHeader(col: string): string {
    return col
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  // Get value from task for a specific column
  private getTaskValue(task: Task, column: string, projectMap?: Map<string, string>): string {
    switch (column) {
      case "id":
        return task.id;
      case "title":
        return task.title;
      case "subtitle":
        return task.subtitle || "";
      case "summary":
        return task.summary || "";
      case "status":
        return task.status;
      case "priority":
        return task.priority;
      case "assignee":
        return task.assignee || "";
      case "projectId":
        return projectMap?.get(task.projectId) || task.projectId;
      case "dueDate":
        return task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : "";
      case "createdAt":
        return task.createdAt ? new Date(task.createdAt).toISOString() : "";
      case "updatedAt":
        return task.updatedAt ? new Date(task.updatedAt).toISOString() : "";
      case "completedAt":
        return task.completedAt ? new Date(task.completedAt).toISOString() : "";
      case "timeEstimate":
        return task.timeEstimate?.toString() || "0";
      case "timeSpent":
        return task.timeSpent?.toString() || "0";
      case "tags":
        return (task.tags || []).join("; ");
      case "subtasks":
        return (task.subtasks || [])
          .map((st) => `${st.completed ? "[x]" : "[ ]"} ${st.title}`)
          .join("; ");
      default:
        // Check custom field values
        if (task.customFieldValues && column in task.customFieldValues) {
          return String(task.customFieldValues[column]);
        }
        return "";
    }
  }

  // Escape a value for CSV (handle commas, quotes, newlines)
  private escapeCSV(value: string): string {
    // Defend against CSV/formula injection: a leading formula character causes
    // spreadsheet apps to evaluate the cell. Prefix with a single quote so the
    // value is treated as literal text. (RFC double-quote wrapping alone does
    // NOT neutralize this — the apostrophe prefix is the actual defense.)
    const isFormula = /^[=+\-@\t\r]/.test(value);
    const escaped = isFormula ? `'${value}` : value;
    // Quote-wrap per RFC 4180 for structural characters, and also whenever a
    // formula prefix was added so the neutralization survives every parser.
    if (isFormula || escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
      return `"${escaped.replace(/"/g, '""')}"`;
    }
    return escaped;
  }

  // Generate JSON export
  exportToJSON(data: Partial<ExportData>): string {
    return JSON.stringify(
      {
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        ...data,
      },
      null,
      2,
    );
  }

  // Trigger file download in browser
  downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  // Returns true when the given column list contains PII or internal identifier columns.
  containsPIIColumns(columns: string[]): boolean {
    return columns.some((col) => (PII_CSV_COLUMNS as readonly string[]).includes(col));
  }

  // Emits a console warning (and, in development, an alert-style message) when
  // the export will include personal information or internal identifiers.
  private warnIfPII(columns: string[]): void {
    if (!this.containsPIIColumns(columns)) return;
    const piiFound = columns.filter((col) => (PII_CSV_COLUMNS as readonly string[]).includes(col));
    // Use console.warn so it is visible in DevTools without being intrusive.
    console.warn(
      `[LiquiTask Export] This CSV export contains columns that may include ` +
        `personal information or internal identifiers: ${piiFound.join(", ")}. ` +
        `Avoid sharing this file externally without first reviewing its contents.`,
    );
  }

  // Export tasks to CSV and download.
  // Defaults to the sanitised (PII-free) column set.  Pass a custom column
  // list — or the full DEFAULT_CSV_COLUMNS — when internal fields are required.
  downloadCSV(
    tasks: Task[],
    filename: string = "tasks.csv",
    projectMap?: Map<string, string>,
    columns: string[] = SANITISED_CSV_COLUMNS,
  ): void {
    this.warnIfPII(columns);
    const csv = this.exportToCSV(tasks, columns, projectMap);
    this.downloadFile(csv, filename, "text/csv;charset=utf-8;");
  }

  // Export data to JSON and download
  downloadJSON(data: Partial<ExportData>, filename: string = "liquitask-export.json"): void {
    const json = this.exportToJSON(data);
    this.downloadFile(json, filename, "application/json");
  }

  // Get the full list of available columns (including PII/internal columns and custom fields).
  // Use this to populate an opt-in column picker, not as an export default.
  getAvailableColumns(customFields: CustomFieldDefinition[] = []): string[] {
    return [...DEFAULT_CSV_COLUMNS, ...customFields.map((cf) => cf.id)];
  }

  // Get the sanitised (PII-free) column list, optionally extended with custom fields.
  // Suitable as a safe default for the column picker pre-selection.
  getSanitisedColumns(customFields: CustomFieldDefinition[] = []): string[] {
    return [...SANITISED_CSV_COLUMNS, ...customFields.map((cf) => cf.id)];
  }

  // Export to Markdown
  exportToMarkdown(tasks: Task[], template?: string): string {
    const defaultTemplate = `# Task Export

Generated: {{date}}

## Tasks

{{#tasks}}
### {{title}}
- **ID:** {{jobId}}
- **Status:** {{status}}
- **Priority:** {{priority}}
- **Assignee:** {{assignee}}
- **Due Date:** {{dueDate}}
- **Description:** {{summary}}

{{/tasks}}
`;

    const tpl = template || defaultTemplate;
    const date = new Date().toLocaleDateString();
    let output = tpl.replace("{{date}}", date);

    const tasksMarkdown = tasks
      .map((task) => {
        let taskMd = tpl.includes("{{#tasks}}")
          ? tpl.split("{{#tasks}}")[1].split("{{/tasks}}")[0]
          : defaultTemplate.split("{{#tasks}}")[1].split("{{/tasks}}")[0];

        taskMd = taskMd
          .replace(/\{\{title\}\}/g, this.escapeMarkdown(task.title))
          .replace(/\{\{jobId\}\}/g, this.escapeMarkdown(task.jobId))
          .replace(/\{\{status\}\}/g, this.escapeMarkdown(task.status))
          .replace(/\{\{priority\}\}/g, this.escapeMarkdown(task.priority))
          .replace(/\{\{assignee\}\}/g, this.escapeMarkdown(task.assignee || "Unassigned"))
          .replace(
            /\{\{dueDate\}\}/g,
            task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No date",
          )
          .replace(/\{\{summary\}\}/g, this.escapeMarkdown(task.summary || ""));

        return taskMd;
      })
      .join("\n\n");

    output = output.replace(/{{#tasks}}[\s\S]*?{{\/tasks}}/, tasksMarkdown);
    return output;
  }

  // Export to iCal (ICS format)
  exportToICS(tasks: Task[], filename: string = "liquitask-calendar.ics"): void {
    const icsLines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//LiquiTask//Task Management//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    tasks.forEach((task) => {
      if (!task.dueDate) return;

      const dueDate = new Date(task.dueDate);
      // Due dates are stored as local-midnight, date-only values. Emit them as
      // RFC 5545 VALUE=DATE so calendar apps keep the user's intended day
      // instead of shifting it by the UTC offset (toISOString() would do that).
      const dueDateStr = this.formatICSDateOnly(dueDate);

      icsLines.push("BEGIN:VTODO");
      icsLines.push(`UID:${task.id}@liquitask`);
      icsLines.push(`DTSTAMP:${this.formatICSDate(new Date())}`);
      icsLines.push(`DUE;VALUE=DATE:${dueDateStr}`);
      icsLines.push(`SUMMARY:${this.escapeICS(task.title)}`);
      if (task.summary) {
        icsLines.push(`DESCRIPTION:${this.escapeICS(task.summary)}`);
      }
      const priority = this.mapICSPriority(task.priority);
      if (priority !== undefined) {
        icsLines.push(`PRIORITY:${priority}`);
      }
      if (task.tags && task.tags.length > 0) {
        // Each category is escaped; the comma separator between categories is literal.
        icsLines.push(`CATEGORIES:${task.tags.map((tag) => this.escapeICS(tag)).join(",")}`);
      }
      icsLines.push(`STATUS:${task.status === "Completed" ? "COMPLETED" : "NEEDS-ACTION"}`);
      icsLines.push("END:VTODO");
    });

    icsLines.push("END:VCALENDAR");

    // RFC 5545 requires lines longer than 75 octets to be folded.
    const icsContent = icsLines.map((line) => this.foldICSLine(line)).join("\r\n");
    this.downloadFile(icsContent, filename, "text/calendar;charset=utf-8");
  }

  // Format a date as an ICS UTC timestamp (e.g. 20240115T093000Z)
  private formatICSDate(date: Date): string {
    return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  }

  // Format a date as an RFC 5545 DATE value (YYYYMMDD) using local components,
  // so a date-only due date is not shifted across days by timezone conversion.
  private formatICSDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  // Map a task priority to the iCal PRIORITY scale (1 = highest, 9 = lowest).
  // Returns undefined for unknown values so PRIORITY is simply omitted.
  private mapICSPriority(priority?: string): number | undefined {
    switch ((priority || "").toLowerCase()) {
      case "high":
      case "urgent":
        return 1;
      case "medium":
      case "normal":
        return 5;
      case "low":
        return 9;
      default:
        return undefined;
    }
  }

  // Fold a single content line to <=75 characters per RFC 5545 section 3.1.
  // Continuation lines are prefixed with a single space.
  private foldICSLine(line: string): string {
    if (line.length <= 75) return line;
    const segments: string[] = [line.slice(0, 75)];
    let index = 75;
    while (index < line.length) {
      segments.push(` ${line.slice(index, index + 74)}`);
      index += 74;
    }
    return segments.join("\r\n");
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>&]/g, '\\$&');
  }

  // Escape text for ICS format
  private escapeICS(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n");
  }
}

// Singleton instance
export const exportService = new ExportService();
export default exportService;
