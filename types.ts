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
  Low = 'low',
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
  icon?: string; // Direct icon key, takes precedence over type
  parentId?: string;
  pinned?: boolean;
  order?: number;
}

export type CustomFieldType = 'text' | 'number' | 'dropdown' | 'url' | 'formula';

export interface CustomFieldDefinition {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[]; // For dropdowns
  formula?: string; // For formula fields (e.g. "{{dueDate}} - {{today}}")
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

export interface ErrorLog {
  timestamp: Date;
  message: string;
}

export type ActivityType = 'create' | 'update' | 'move' | 'comment' | 'delete';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: Date;
  userId: string; // 'user' for now
  details: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
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
  updatedAt?: Date;
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
  errorLogs?: ErrorLog[]; // For tracking errors related to this task
  activity?: ActivityItem[]; // Audit trail
  order?: number; // Position within column (for manual reordering)
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
  priority?: string; // Filter by priority level
  status?: string; // Filter by status/column
  showCompleted?: boolean; // Include completed tasks
}

// Saved View for persisting filter configurations
export interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
  // Advanced query builder state
  advancedFilter?: unknown; // Actually FilterGroup from src/types/queryTypes
  grouping: 'none' | 'priority';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  createdAt: Date;
  isDefault?: boolean;
}

// Task Template
export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  taskData: Partial<Task>;
  subtasks: Subtask[];
  tags: string[];
  customFieldValues: Record<string, string | number>;
  variables?: string[]; // e.g., ['projectName', 'assignee']
}

// AI Task Management & Cleanup Types
export interface DuplicateGroup {
  id: string;
  tasks: Task[];
  confidence: number; // 0-1
  reasons: string[]; // AI-explained reasons
}

export interface MergeSuggestion {
  keepTaskId: string;
  archiveTaskIds: string[];
  mergedFields: Partial<Task>;
  reasoning: string;
}

export interface RedundancyAnalysis {
  taskId: string;
  type: 'subset' | 'completed-overlap' | 'stale' | 'blocked-completed';
  relatedTaskId?: string;
  confidence: number;
  reasoning: string;
  suggestedAction: 'archive' | 'convert-to-subtask' | 'update' | 'delete';
}

export interface AISuggestion {
  id: string;
  type: 'priority' | 'tag' | 'project' | 'due-date' | 'subtask' | 'assignment';
  taskId: string;
  suggestedValue: unknown;
  currentValue: unknown;
  confidence: number;
  reasoning: string;
}

export interface AICategorySuggestion {
  taskId: string;
  suggestedProjectId?: string;
  suggestedTags: string[];
  suggestedPriority?: string;
  confidence: number;
  reasoning: string;
}

export interface AIScheduleSuggestion {
  taskId: string;
  suggestedDueDate?: Date;
  suggestedTimeEstimate?: number;
  conflicts: string[];
  reasoning: string;
}

export interface AIInsight {
  id: string;
  type: 'productivity' | 'bottleneck' | 'estimate-accuracy' | 'pattern' | 'recommendation';
  title: string;
  description: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface AIAutomationRule {
  id: string;
  naturalLanguage: string;
  trigger: string;
  conditions: string;
  actions: string;
  enabled: boolean;
  createdAt: Date;
}

export interface TaskCluster {
  id: string;
  taskIds: string[];
  theme: string;
  suggestedTags: string[];
  confidence: number;
}

// AI Provider configuration (extended)
export type AIProviderId = 'gemini' | 'ollama';

export interface AIConfig {
  provider: AIProviderId;
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  // AI Management settings
  autoDetectDuplicates?: boolean;
  autoSuggestPriorities?: boolean;
  autoSuggestTags?: boolean;
  cleanupOnCreate?: boolean;
  insightsFrequency?: 'daily' | 'weekly' | 'manual';
}

export interface AITaskSchema {
  reasoning?: string; // Step-by-step analysis before final output
  title: string;
  summary: string;
  priority: string;
  dueDate?: string; // ISO string
  tags: string[];
  timeEstimate: number; // in minutes
  subtasks?: string[];
}

export interface AIContext {
  activeProjectId: string;
  projects: Project[];
  priorities: PriorityDefinition[];
}

export interface AITestResult {
  ok: boolean;
  stage: 'config' | 'service' | 'model' | 'inference';
  message: string;
}

// Migration system types
export interface Migration {
  version: string;
  description: string;
  migrate: (data: MigratableAppData) => MigratableAppData;
}

export interface MigrationResult {
  success: boolean;
  migratedFrom: string;
  migratedTo: string;
  data?: MigratableAppData;
  error?: string;
  backupId?: string;
}

export interface BackupInfo {
  id: string;
  version: string;
  timestamp: Date;
  size: number;
}

// App data structure for migration (mirrors storageService.AppData)
export interface MigratableAppData {
  columns?: BoardColumn[];
  projectTypes?: ProjectType[];
  priorities?: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
  projects?: Project[];
  tasks?: Task[];
  activeProjectId?: string;
  sidebarCollapsed?: boolean;
  grouping?: 'none' | 'priority';
  version?: string;
  savedViews?: SavedView[];
  // Allow additional fields for forward compatibility
  [key: string]: unknown;
}
