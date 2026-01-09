import { Task, Subtask } from '../../types';

/**
 * Simplified task input for bulk import.
 * Users provide this format - the system fills in IDs, projectId, status, etc.
 */
export interface BulkTaskInput {
    title: string;
    subtitle?: string;
    summary?: string;
    priority?: 'high' | 'medium' | 'low' | string;
    assignee?: string;
    dueDate?: string; // ISO date string
    tags?: string[];
    timeEstimate?: number; // minutes
    subtasks?: { title: string; completed?: boolean }[];
}

export interface BulkImportPayload {
    tasks: BulkTaskInput[];
}

export interface ValidationResult {
    valid: boolean;
    tasks?: Partial<Task>[];
    error?: string;
    warnings?: string[];
}

/**
 * JSON Template example for users
 */
export const BULK_TASK_TEMPLATE_JSON = `{
  "tasks": [
    {
      "title": "Example Task 1",
      "priority": "high",
      "assignee": "John Doe",
      "dueDate": "2024-12-31",
      "tags": ["urgent", "feature"],
      "timeEstimate": 120,
      "subtasks": [
        { "title": "Subtask A", "completed": false },
        { "title": "Subtask B", "completed": true }
      ]
    },
    {
      "title": "Example Task 2",
      "subtitle": "Optional subtitle",
      "summary": "A longer description of the task",
      "priority": "medium"
    }
  ]
}`;

/**
 * Validates and transforms bulk task JSON input
 */
export function validateBulkTasks(jsonString: string): ValidationResult {
    const warnings: string[] = [];

    // Parse JSON
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonString);
    } catch {
        return { valid: false, error: 'Invalid JSON syntax. Please check your input.' };
    }

    // Check structure
    if (!parsed || typeof parsed !== 'object') {
        return { valid: false, error: 'Input must be a JSON object.' };
    }

    const payload = parsed as Record<string, unknown>;

    // Check for tasks array
    if (!Array.isArray(payload.tasks)) {
        return { valid: false, error: 'Missing "tasks" array. Expected format: { "tasks": [...] }' };
    }

    const tasksArray = payload.tasks as unknown[];

    if (tasksArray.length === 0) {
        return { valid: false, error: 'Tasks array is empty. Add at least one task.' };
    }

    if (tasksArray.length > 100) {
        return { valid: false, error: 'Too many tasks. Maximum 100 tasks per import.' };
    }

    // Validate each task
    const validatedTasks: Partial<Task>[] = [];

    for (let i = 0; i < tasksArray.length; i++) {
        const task = tasksArray[i];
        const prefix = `Task ${i + 1}`;

        if (!task || typeof task !== 'object') {
            return { valid: false, error: `${prefix}: Must be an object.` };
        }

        const taskObj = task as Record<string, unknown>;

        // Title is required
        if (typeof taskObj.title !== 'string' || !taskObj.title.trim()) {
            return { valid: false, error: `${prefix}: Missing or invalid "title" (required).` };
        }

        // Validate priority if provided
        const allowedPriorities = ['high', 'medium', 'low'];
        let priority = 'medium';
        if (taskObj.priority !== undefined) {
            if (typeof taskObj.priority !== 'string') {
                return { valid: false, error: `${prefix}: "priority" must be a string.` };
            }
            priority = taskObj.priority;
            if (!allowedPriorities.includes(priority.toLowerCase())) {
                warnings.push(`${prefix}: Unknown priority "${priority}", using as-is.`);
            }
        }

        // Validate dueDate if provided
        let dueDate: Date | undefined;
        if (taskObj.dueDate !== undefined) {
            if (typeof taskObj.dueDate !== 'string') {
                return { valid: false, error: `${prefix}: "dueDate" must be a date string (YYYY-MM-DD).` };
            }
            const parsed = new Date(taskObj.dueDate);
            if (isNaN(parsed.getTime())) {
                return { valid: false, error: `${prefix}: Invalid date format for "dueDate".` };
            }
            dueDate = parsed;
        }

        // Validate tags if provided
        let tags: string[] = [];
        if (taskObj.tags !== undefined) {
            if (!Array.isArray(taskObj.tags)) {
                return { valid: false, error: `${prefix}: "tags" must be an array of strings.` };
            }
            tags = taskObj.tags.filter((t): t is string => typeof t === 'string');
        }

        // Validate timeEstimate if provided
        let timeEstimate = 0;
        if (taskObj.timeEstimate !== undefined) {
            if (typeof taskObj.timeEstimate !== 'number' || taskObj.timeEstimate < 0) {
                return { valid: false, error: `${prefix}: "timeEstimate" must be a positive number (minutes).` };
            }
            timeEstimate = taskObj.timeEstimate;
        }

        // Validate subtasks if provided
        const subtasks: Subtask[] = [];
        if (taskObj.subtasks !== undefined) {
            if (!Array.isArray(taskObj.subtasks)) {
                return { valid: false, error: `${prefix}: "subtasks" must be an array.` };
            }
            for (let j = 0; j < taskObj.subtasks.length; j++) {
                const sub = taskObj.subtasks[j] as Record<string, unknown>;
                if (!sub || typeof sub !== 'object') {
                    return { valid: false, error: `${prefix}: Subtask ${j + 1} must be an object.` };
                }
                if (typeof sub.title !== 'string' || !sub.title.trim()) {
                    return { valid: false, error: `${prefix}: Subtask ${j + 1} missing "title".` };
                }
                subtasks.push({
                    id: `subtask-${Date.now()}-${j}`,
                    title: sub.title.trim(),
                    completed: Boolean(sub.completed),
                });
            }
        }

        // Build validated task
        validatedTasks.push({
            title: taskObj.title.trim(),
            subtitle: typeof taskObj.subtitle === 'string' ? taskObj.subtitle.trim() : '',
            summary: typeof taskObj.summary === 'string' ? taskObj.summary.trim() : '',
            priority,
            assignee: typeof taskObj.assignee === 'string' ? taskObj.assignee.trim() : '',
            dueDate,
            tags,
            timeEstimate,
            subtasks,
        });
    }

    return {
        valid: true,
        tasks: validatedTasks,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

/**
 * Generate a downloadable template file content
 */
export function generateTemplateBlob(): Blob {
    return new Blob([BULK_TASK_TEMPLATE_JSON], { type: 'application/json' });
}
