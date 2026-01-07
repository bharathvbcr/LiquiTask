
export type TaskStatus = string;

export type GroupingOption = 'none' | 'priority';

export interface PriorityDefinition {
  id: string;
  label: string;
  color: string; // Hex code
  level: number; // For sorting (1 is highest)
  icon?: string; // Icon key
}

export enum Priority {
  High = 'high',
  Medium = 'medium',
  Low = 'low'
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: 'file' | 'link';
}

export interface ProjectType {
  id: string;
  label: string;
  icon: string;
}

export interface Project {
  id: string;
  name: string;
  type: string;
  parentId?: string;
  pinned?: boolean;
  order?: number;
}

export type CustomFieldType = 'text' | 'number' | 'dropdown' | 'url';

export interface CustomFieldDefinition {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[]; // For dropdowns
}

export type LinkType = 'blocks' | 'blocked-by' | 'relates-to' | 'duplicates';

export interface TaskLink {
  targetTaskId: string;
  type: LinkType;
}

// Recurring task configuration
export interface RecurringConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  interval: number; // e.g., every 2 weeks
  daysOfWeek?: number[]; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  endDate?: Date;
  nextOccurrence?: Date;
}

export interface Task {
  id: string;
  jobId: string;
  projectId: string;
  title: string;
  subtitle: string;
  summary: string;
  assignee: string;
  priority: string;
  status: TaskStatus;
  createdAt: Date;
  dueDate?: Date;
  subtasks: Subtask[];
  attachments: Attachment[];
  customFieldValues?: Record<string, string | number>;
  links?: TaskLink[];
  // New fields
  tags: string[];
  timeEstimate: number; // in minutes
  timeSpent: number; // in minutes
  recurring?: RecurringConfig;
  completedAt?: Date;
}

export interface BoardColumn {
  id: string;
  title: string;
  color: string;
  isCompleted?: boolean;
  wipLimit?: number;
}

export interface ColumnData {
  id: string;
  title: string;
  tasks: Task[];
}

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export interface FilterState {
  assignee: string;
  dateRange: 'due' | 'created' | null;
  startDate: string;
  endDate: string;
  tags: string;
}
