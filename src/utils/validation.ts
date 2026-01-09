import { z } from 'zod';
import { Task, Project, BoardColumn, ProjectType, PriorityDefinition, CustomFieldDefinition } from '../../types';

// Validation schemas
export const SubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  type: z.enum(['file', 'link']),
});

export const TaskLinkSchema = z.object({
  targetTaskId: z.string(),
  type: z.enum(['blocks', 'blocked-by', 'relates-to', 'duplicates']),
});

export const RecurringConfigSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  interval: z.number(),
  daysOfWeek: z.array(z.number()).optional(),
  dayOfMonth: z.number().optional(),
  endDate: z.date().optional(),
  nextOccurrence: z.date().optional(),
}).optional();

export const TaskSchema: z.ZodType<Task> = z.object({
  id: z.string(),
  jobId: z.string(),
  projectId: z.string(),
  title: z.string().min(1, 'Title is required'),
  subtitle: z.string(),
  summary: z.string(),
  assignee: z.string(),
  priority: z.string(),
  status: z.string(),
  createdAt: z.date(),
  dueDate: z.date().optional(),
  subtasks: z.array(SubtaskSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  customFieldValues: z.record(z.string(), z.union([z.string(), z.number()])).default({}) as z.ZodType<Record<string, string | number>>,
  links: z.array(TaskLinkSchema).default([]),
  tags: z.array(z.string()).default([]),
  timeEstimate: z.number().default(0),
  timeSpent: z.number().default(0),
  recurring: RecurringConfigSchema,
  completedAt: z.date().optional(),
});

export const ProjectSchema: z.ZodType<Project> = z.object({
  id: z.string(),
  name: z.string().min(1, 'Project name is required'),
  type: z.string(),
  parentId: z.string().optional(),
  pinned: z.boolean().optional(),
  order: z.number().optional(),
});

export const BoardColumnSchema: z.ZodType<BoardColumn> = z.object({
  id: z.string(),
  title: z.string().min(1, 'Column title is required'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code'),
  isCompleted: z.boolean().optional(),
  wipLimit: z.number().min(0).optional(),
});

export const ProjectTypeSchema: z.ZodType<ProjectType> = z.object({
  id: z.string(),
  label: z.string().min(1, 'Label is required'),
  icon: z.string(),
});

export const PriorityDefinitionSchema: z.ZodType<PriorityDefinition> = z.object({
  id: z.string(),
  label: z.string().min(1, 'Label is required'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code'),
  level: z.number().int().positive(),
  icon: z.string().optional(),
});

export const CustomFieldDefinitionSchema: z.ZodType<CustomFieldDefinition> = z.object({
  id: z.string(),
  label: z.string().min(1, 'Label is required'),
  type: z.enum(['text', 'number', 'dropdown', 'url']),
  options: z.array(z.string()).optional(),
});

// App data schema for import/export
// App data schema for import/export
export const AppDataSchema = z.object({
  columns: z.array(BoardColumnSchema).optional(),
  projectTypes: z.array(ProjectTypeSchema).optional(),
  priorities: z.array(PriorityDefinitionSchema).optional(),
  customFields: z.array(CustomFieldDefinitionSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  tasks: z.array(TaskSchema).optional(),
  activeProjectId: z.string().optional(),
  sidebarCollapsed: z.boolean().optional(),
  grouping: z.enum(['none', 'priority']).optional(),
  version: z.string().optional(), // For migration tracking
});

export type ValidatedAppData = z.infer<typeof AppDataSchema>;

// Helper function to parse and validate dates from JSON
function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

// Validate and transform imported data
// Validate and transform imported data
export function validateAndTransformImportedData(data: unknown): ValidatedAppData | null {
  try {
    // First, transform dates from strings to Date objects
    const dataRecord = data as Record<string, unknown> | null;
    if (!dataRecord) return null;

    const rawTasks = Array.isArray(dataRecord.tasks) ? dataRecord.tasks as Record<string, unknown>[] : [];

    const transformed = {
      ...dataRecord,
      tasks: rawTasks.map((t) => {
        const recurring = t.recurring as Record<string, unknown> | undefined;
        return {
          ...t,
          createdAt: parseDate(t.createdAt) || new Date(),
          dueDate: parseDate(t.dueDate),
          completedAt: parseDate(t.completedAt),
          recurring: recurring ? {
            ...recurring,
            endDate: parseDate(recurring.endDate),
            nextOccurrence: parseDate(recurring.nextOccurrence),
          } : undefined,
        };
      }),
    };

    // Validate with Zod
    const validated = AppDataSchema.parse(transformed);
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues || (error as { errors?: z.ZodIssue[] }).errors || [];
      console.error('Validation errors:', issues);
      throw new Error(`Validation failed: ${issues.map((e) => {
        const path = e.path ? e.path.join('.') : 'unknown';
        return `${path}: ${e.message}`;
      }).join(', ')}`);
    }
    throw error;
  }
}

