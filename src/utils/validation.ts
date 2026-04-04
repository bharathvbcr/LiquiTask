import { z } from "zod";
import type {
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  ProjectType,
  Task,
} from "../../types";

// Validation schemas
export const SubtaskSchema = z.object({
  id: z.string().trim(),
  title: z.string().trim(),
  completed: z.boolean(),
}).readonly();

export const AttachmentSchema = z.object({
  id: z.string().trim(),
  name: z.string().trim(),
  url: z.string().trim(),
  type: z.enum(["file", "link"]),
}).readonly();

export const TaskLinkSchema = z.object({
  targetTaskId: z.string().trim(),
  type: z.enum(["blocks", "blocked-by", "relates-to", "duplicates"]),
}).readonly();

export const ErrorLogSchema = z.object({
  timestamp: z.coerce.date(),
  message: z.string().trim(),
}).readonly();

export const RecurringConfigSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(["daily", "weekly", "monthly", "custom"]),
    interval: z.number().positive(),
    daysOfWeek: z.array(z.number()).optional(),
    dayOfMonth: z.number().optional(),
    endDate: z.coerce.date().optional(),
    nextOccurrence: z.coerce.date().optional(),
  })
  .optional();

export const TaskSchema: z.ZodType<Task> = z.object({
  id: z.string().trim(),
  jobId: z.string().trim(),
  projectId: z.string().trim(),
  title: z.string().trim().min(1, "Title is required"),
  subtitle: z.string().trim(),
  summary: z.string().trim(),
  assignee: z.string().trim(),
  priority: z.string().trim(),
  status: z.string().trim(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  subtasks: z.array(SubtaskSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  customFieldValues: z
    .record(z.string().trim(), z.union([z.string().trim(), z.number()]))
    .default({}) as z.ZodType<Record<string, string | number>>,
  links: z.array(TaskLinkSchema).default([]),
  tags: z.array(z.string().trim()).default([]),
  timeEstimate: z.number().min(0).default(0),
  timeSpent: z.number().min(0).default(0),
  recurring: RecurringConfigSchema,
  completedAt: z.coerce.date().optional(),
  errorLogs: z.array(ErrorLogSchema).optional(),
}).readonly();

export const ProjectSchema: z.ZodType<Project> = z.object({
  id: z.string().trim(),
  name: z.string().trim().min(1, "Project name is required"),
  type: z.string().trim(),
  parentId: z.string().trim().optional(),
  pinned: z.boolean().optional(),
  order: z.number().optional(),
}).readonly();

export const BoardColumnSchema: z.ZodType<BoardColumn> = z.object({
  id: z.string().trim(),
  title: z.string().trim().min(1, "Column title is required"),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex code"),
  isCompleted: z.boolean().optional(),
  wipLimit: z.number().min(0).optional(),
}).readonly();

export const ProjectTypeSchema: z.ZodType<ProjectType> = z.object({
  id: z.string().trim(),
  label: z.string().trim().min(1, "Label is required"),
  icon: z.string().trim(),
}).readonly();

export const PriorityDefinitionSchema: z.ZodType<PriorityDefinition> = z.object({
  id: z.string().trim(),
  label: z.string().trim().min(1, "Label is required"),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex code"),
  level: z.number().int().positive(),
  icon: z.string().trim().optional(),
}).readonly();

export const CustomFieldDefinitionSchema: z.ZodType<CustomFieldDefinition> = z.object({
  id: z.string().trim(),
  label: z.string().trim().min(1, "Label is required"),
  type: z.enum(["text", "number", "dropdown", "url", "formula"]),
  options: z.array(z.string().trim()).optional(),
  formula: z.string().trim().optional(),
}).readonly();

// App data schema for import/export
export const AppDataSchema = z.object({
  columns: z.array(BoardColumnSchema).optional(),
  projectTypes: z.array(ProjectTypeSchema).optional(),
  priorities: z.array(PriorityDefinitionSchema).optional(),
  customFields: z.array(CustomFieldDefinitionSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  tasks: z.array(TaskSchema).optional(),
  activeProjectId: z.string().trim().optional(),
  sidebarCollapsed: z.boolean().optional(),
  grouping: z.enum(["none", "priority"]).optional(),
  version: z.string().trim().optional(), // For migration tracking
}).readonly();

export type ValidatedAppData = z.infer<typeof AppDataSchema>;

// Helper function to parse and validate dates from JSON
function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

// URL validation and sanitization
export function sanitizeUrl(url: string): string {
  if (!url) return "";
  let sanitized = url.trim();
  // Remove trailing slashes
  sanitized = sanitized.replace(/\/+$/, "");
  // Add protocol if missing
  if (sanitized && !/^https?:\/\//i.test(sanitized)) {
    sanitized = `http://${sanitized}`;
  }
  return sanitized;
}

export function isValidUrl(url: string): boolean {
  if (!url) return false;
  try {
    new URL(sanitizeUrl(url));
    return true;
  } catch {
    return false;
  }
}

// Validate and transform imported data
// Validate and transform imported data
export function validateAndTransformImportedData(data: unknown): ValidatedAppData | null {
  try {
    // First, transform dates from strings to Date objects
    const dataRecord = data as Record<string, unknown> | null;
    if (!dataRecord) return null;

    const rawTasks = Array.isArray(dataRecord.tasks)
      ? (dataRecord.tasks as Record<string, unknown>[])
      : [];

    const transformed = {
      ...dataRecord,
      tasks: rawTasks.map((t) => {
        const recurring = t.recurring as Record<string, unknown> | undefined;
        const errorLogs = Array.isArray(t.errorLogs)
          ? (t.errorLogs as Record<string, unknown>[]).map((log) => ({
              timestamp: parseDate(log.timestamp) || new Date(),
              message: (log.message as string) || "",
            }))
          : undefined;
        return {
          ...t,
          createdAt: parseDate(t.createdAt) || new Date(),
          updatedAt: parseDate(t.updatedAt),
          dueDate: parseDate(t.dueDate),
          completedAt: parseDate(t.completedAt),
          errorLogs: errorLogs,
          recurring: recurring
            ? {
                ...recurring,
                endDate: parseDate(recurring.endDate),
                nextOccurrence: parseDate(recurring.nextOccurrence),
              }
            : undefined,
        };
      }),
    };

    // Validate with Zod
    const validated = AppDataSchema.parse(transformed);
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues || (error as { errors?: z.ZodIssue[] }).errors || [];
      console.error("Validation errors:", issues);
      throw new Error(
        `Validation failed: ${issues
          .map((e) => {
            const path = e.path ? e.path.join(".") : "unknown";
            return `${path}: ${e.message}`;
          })
          .join(", ")}`,
      );
    }
    throw error;
  }
}
