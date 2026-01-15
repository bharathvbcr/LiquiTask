// Storage keys - eliminates magic strings
export const STORAGE_KEYS = {
    COLUMNS: 'liquitask-columns',
    PROJECT_TYPES: 'liquitask-project-types',
    PRIORITIES: 'liquitask-priorities',
    CUSTOM_FIELDS: 'liquitask-custom-fields',
    PROJECTS: 'liquitask-projects',
    TASKS: 'liquitask-tasks',
    ACTIVE_PROJECT: 'liquitask-active-project',
    SIDEBAR_COLLAPSED: 'liquitask-sidebar-collapsed',
    GROUPING: 'liquitask-grouping',
    TASK_TEMPLATES: 'liquitask-task-templates',
    SEARCH_HISTORY: 'liquitask-search-history',
    COMPACT_VIEW: 'liquitask-compact-view',
    SHOW_SUB_WORKSPACE_TASKS: 'liquitask-show-sub-workspace-tasks',
    VIEW_MODE: 'liquitask-view-mode',
    CURRENT_VIEW: 'liquitask-current-view',
    // Migration system keys
    DATA_VERSION: 'liquitask-data-version',
    BACKUPS: 'liquitask-backups',
    MIGRATION_LOG: 'liquitask-migration-log',
} as const;

// Default column configuration
export const DEFAULT_COLUMNS = [
    { id: 'Pending', title: 'Pending', color: '#64748b', wipLimit: 0 },
    { id: 'InProgress', title: 'In Progress', color: '#3b82f6', wipLimit: 10 },
    { id: 'Completed', title: 'Completed', color: '#10b981', isCompleted: true, wipLimit: 0 },
    { id: 'Delivered', title: 'Delivered', color: '#a855f7', wipLimit: 0 }
] as const;

// Default project types
export const DEFAULT_PROJECT_TYPES = [
    { id: 'folder', label: 'General', icon: 'folder' },
    { id: 'dev', label: 'Development', icon: 'code' },
    { id: 'marketing', label: 'Marketing', icon: 'megaphone' },
    { id: 'mobile', label: 'Mobile App', icon: 'smartphone' },
    { id: 'inventory', label: 'Inventory', icon: 'box' },
] as const;

// Default priorities
export const DEFAULT_PRIORITIES = [
    { id: 'high', label: 'High', color: '#ef4444', level: 1, icon: 'flame' },
    { id: 'medium', label: 'Medium', color: '#eab308', level: 2, icon: 'clock' },
    { id: 'low', label: 'Low', color: '#10b981', level: 3, icon: 'arrow-down' },
] as const;

// Default projects
export const DEFAULT_PROJECTS = [] as const;

// Column status constants
export const COLUMN_STATUS = {
    PENDING: 'Pending',
    IN_PROGRESS: 'InProgress',
    COMPLETED: 'Completed',
    DELIVERED: 'Delivered',
} as const;

// Link types
export const LINK_TYPES = {
    BLOCKS: 'blocks',
    BLOCKED_BY: 'blocked-by',
    RELATES_TO: 'relates-to',
    DUPLICATES: 'duplicates',
} as const;
