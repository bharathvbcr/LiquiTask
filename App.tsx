import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { FilterBuilder } from './src/components/FilterBuilder';
import { SavedViewControls } from './src/components/SavedViewControls';
import { executeAdvancedFilter } from './src/utils/queryEngine';
import { FilterGroup } from './src/types/queryTypes';
import useSavedViews from './src/hooks/useSavedViews';
import { useKeybinding } from './src/context/KeybindingContext';
import { activityService } from './src/services/activityService';
import { useConfirmation } from './src/contexts/ConfirmationContext';

import { LiquidButton } from './components/LiquidButton';
import { TaskFormModal } from './components/TaskFormModal';
import { ProjectModal } from './components/ProjectModal';
import { SettingsModal } from './components/SettingsModal';
import { Dashboard } from './components/Dashboard';
import GanttView from './src/components/GanttView';
import { Toast } from './components/Toast';
import { ViewSwitcher } from './src/components/ViewSwitcher';
import { ViewTransition } from './src/components/ViewTransition';
import { TitleBar } from './components/TitleBar';
import { Task, Project, BoardColumn, ProjectType, PriorityDefinition, GroupingOption, ToastMessage, ToastType, CustomFieldDefinition, FilterState } from './types';
import { Search, Bell, Filter, Calendar, Tag, User, Undo2, Loader2, Command, Maximize2, Minimize2 } from 'lucide-react';
import { debounce } from './src/utils/debounce';
import storageService from './src/services/storageService';
import { STORAGE_KEYS, COLUMN_STATUS } from './src/constants';
import ProjectBoard from './src/components/ProjectBoard';

// Power User Features
import { CommandPalette, CommandAction } from './src/components/CommandPalette';
import { SearchHistoryDropdown } from './src/components/SearchHistoryDropdown';
import { useSearchHistory } from './src/hooks/useSearchHistory';
import { notificationService } from './src/services/notificationService';
import { exportService } from './src/services/exportService';
import { initializeRecurringTaskService, getRecurringTaskService } from './src/services/recurringTaskService';
import { archiveService } from './src/services/archiveService';
import { indexedDBService } from './src/services/indexedDBService';
import { searchIndexService } from './src/services/searchIndexService';
import { automationService } from './src/services/automationService';
import { templateService } from './src/services/templateService';

import logo from './src/assets/logo.png';

// Initial Projects (Fallback)
const defaultProjects: Project[] = [];

// Initial Columns (Fallback)
const defaultColumns: BoardColumn[] = [
  { id: 'Pending', title: 'Pending', color: '#64748b', wipLimit: 0 },
  { id: 'InProgress', title: 'In Progress', color: '#3b82f6', wipLimit: 10 },
  { id: 'Completed', title: 'Completed', color: '#10b981', isCompleted: true, wipLimit: 0 },
  { id: 'Delivered', title: 'Delivered', color: '#a855f7', wipLimit: 0 }
];

// Initial Project Types (Fallback)
const defaultProjectTypes: ProjectType[] = [
  { id: 'folder', label: 'General', icon: 'folder' },
  { id: 'dev', label: 'Development', icon: 'code' },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { id: 'mobile', label: 'Mobile App', icon: 'smartphone' },
  { id: 'inventory', label: 'Inventory', icon: 'box' },
];

// Initial Priorities (Fallback)
const defaultPriorities: PriorityDefinition[] = [
  { id: 'high', label: 'High', color: '#ef4444', level: 1, icon: 'flame' },
  { id: 'medium', label: 'Medium', color: '#eab308', level: 2, icon: 'clock' },
  { id: 'low', label: 'Low', color: '#10b981', level: 3, icon: 'arrow-down' },
];

const App: React.FC = () => {
  const { confirm } = useConfirmation();
  // --- State Initialization ---
  // State Initialization
  const [isLoaded, setIsLoaded] = useState(false);

  const [columns, setColumns] = useState<BoardColumn[]>(defaultColumns);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>(defaultProjectTypes);
  const [priorities, setPriorities] = useState<PriorityDefinition[]>(defaultPriorities);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [projects, setProjects] = useState<Project[]>(defaultProjects);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [boardGrouping, setBoardGrouping] = useState<GroupingOption>('none');
  const [isCompactView, setIsCompactView] = useState<boolean>(false);
  const [showSubWorkspaceTasks, setShowSubWorkspaceTasks] = useState<boolean>(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(false);





  const [currentView, setCurrentView] = useState<'project' | 'dashboard' | 'gantt'>('project');
  const [viewMode, setViewMode] = useState<'board' | 'gantt' | 'stats' | 'calendar'>('board');

  // Preserve view mode when switching between dashboard and project views
  // Only adjust if the current viewMode is incompatible with the new currentView
  useEffect(() => {
    if (currentView === 'dashboard' && (viewMode === 'board' || viewMode === 'gantt')) {
      // If switching to dashboard with board/gantt mode, default to stats
      // But only if we just switched views (not on initial load)
      const savedViewMode = storageService.get(STORAGE_KEYS.VIEW_MODE, 'board');
      if (!savedViewMode || savedViewMode === 'board' || savedViewMode === 'gantt') {
        setViewMode('stats');
      }
    } else if (currentView === 'project' && (viewMode === 'stats' || viewMode === 'calendar')) {
      // If switching to project with stats/calendar mode, default to board
      setViewMode('board');
    }
  }, [currentView, viewMode]);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter Panel State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    assignee: '',
    dateRange: null,
    startDate: '',
    endDate: '',
    tags: ''
  });
  const [activeFilterGroup, setActiveFilterGroup] = useState<FilterGroup>({ id: 'root', operator: 'AND', rules: [] });

  // Notification permission state
  const [notificationPermission, setNotificationPermission] = useState<'granted' | 'denied' | 'default'>('default');

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission as 'granted' | 'denied' | 'default');
    }
  }, []);

  // Helper to check if filters are active
  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.assignee ||
      filters.tags ||
      (filters.dateRange && filters.startDate && filters.endDate) ||
      activeFilterGroup.rules.length > 0
    );
  }, [filters, activeFilterGroup]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.assignee) count++;
    if (filters.tags) count++;
    if (filters.dateRange && filters.startDate && filters.endDate) count++;
    if (activeFilterGroup.rules.length > 0) count += activeFilterGroup.rules.length;
    return count;
  }, [filters, activeFilterGroup]);

  // Modals
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [creatingSubProjectFor, setCreatingSubProjectFor] = useState<string | undefined>(undefined);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Toast System
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Power User Feature State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchHistory = useSearchHistory();

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Undo/Redo System
  interface UndoAction {
    type: 'task-create' | 'task-update' | 'task-delete' | 'task-move';
    task?: Task;
    previousState?: Task;
    taskId?: string;
  }
  const undoStack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const MAX_UNDO = 20;

  const pushUndo = useCallback((action: UndoAction) => {
    undoStack.current = [action, ...undoStack.current.slice(0, MAX_UNDO - 1)];
    setCanUndo(undoStack.current.length > 0);
  }, []);

  // Toast functions (defined early for use in undo)
  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleUndo = useCallback(() => {
    const action = undoStack.current.shift();
    setCanUndo(undoStack.current.length > 0);

    if (!action) {
      addToast('Nothing to undo', 'info');
      return;
    }

    switch (action.type) {
      case 'task-delete':
        if (action.task) {
          setTasks(prev => [...prev, action.task!]);
          addToast(`Restored "${action.task.title}"`, 'success');
        }
        break;
      case 'task-update':
        if (action.previousState) {
          setTasks(prev => prev.map(t => t.id === action.previousState!.id ? action.previousState! : t));
          addToast('Change undone', 'info');
        }
        break;
      case 'task-create':
        if (action.taskId) {
          setTasks(prev => prev.filter(t => t.id !== action.taskId));
          addToast('Task creation undone', 'info');
        }
        break;
      case 'task-move':
        if (action.previousState) {
          setTasks(prev => prev.map(t => t.id === action.previousState!.id ? action.previousState! : t));
          addToast('Move undone', 'info');
        }
        break;
    }
  }, [addToast]);

  // Debounced storage writes
  const debouncedSaveColumns = useMemo(() => debounce((cols: BoardColumn[]) => {
    storageService.set(STORAGE_KEYS.COLUMNS, cols);
  }, 500), []);

  const debouncedSaveProjectTypes = useMemo(() => debounce((types: ProjectType[]) => {
    storageService.set(STORAGE_KEYS.PROJECT_TYPES, types);
  }, 500), []);

  const debouncedSavePriorities = useMemo(() => debounce((prios: PriorityDefinition[]) => {
    storageService.set(STORAGE_KEYS.PRIORITIES, prios);
  }, 500), []);

  const debouncedSaveCustomFields = useMemo(() => debounce((fields: CustomFieldDefinition[]) => {
    storageService.set(STORAGE_KEYS.CUSTOM_FIELDS, fields);
  }, 500), []);

  const debouncedSaveProjects = useMemo(() => debounce((projs: Project[]) => {
    storageService.set(STORAGE_KEYS.PROJECTS, projs);
  }, 500), []);

  const debouncedSaveTasks = useMemo(() => debounce((tsks: Task[]) => {
    storageService.set(STORAGE_KEYS.TASKS, tsks);
  }, 500), []);

  // --- Effects ---
  useEffect(() => {
    if (isLoaded) debouncedSaveColumns(columns);
  }, [columns, debouncedSaveColumns, isLoaded]);
  useEffect(() => { if (isLoaded) debouncedSaveProjectTypes(projectTypes); }, [projectTypes, debouncedSaveProjectTypes, isLoaded]);
  useEffect(() => { if (isLoaded) debouncedSavePriorities(priorities); }, [priorities, debouncedSavePriorities, isLoaded]);
  useEffect(() => { if (isLoaded) debouncedSaveCustomFields(customFields); }, [customFields, debouncedSaveCustomFields, isLoaded]);
  useEffect(() => { if (isLoaded) debouncedSaveProjects(projects); }, [projects, debouncedSaveProjects, isLoaded]);
  useEffect(() => { if (isLoaded) debouncedSaveTasks(tasks); }, [tasks, debouncedSaveTasks, isLoaded]);

  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.ACTIVE_PROJECT, activeProjectId);
  }, [activeProjectId, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.SIDEBAR_COLLAPSED, isSidebarCollapsed);
  }, [isSidebarCollapsed, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.GROUPING, boardGrouping);
  }, [boardGrouping, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.COMPACT_VIEW, isCompactView);
  }, [isCompactView, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.SHOW_SUB_WORKSPACE_TASKS, showSubWorkspaceTasks);
  }, [showSubWorkspaceTasks, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.VIEW_MODE, viewMode);
  }, [viewMode, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.CURRENT_VIEW, currentView);
  }, [currentView, isLoaded]);

  // Initial Data Load
  useEffect(() => {
    const loadData = async () => {
      // Initialize IndexedDB (with localStorage fallback)
      try {
        await indexedDBService.initialize();
        if (indexedDBService.isAvailable()) {
          // console.log('[Storage] Using IndexedDB for improved performance');
        } else {
          // console.log('[Storage] IndexedDB not available, using localStorage');
        }
      } catch (error) {
        console.warn('[Storage] IndexedDB initialization failed, using localStorage:', error);
      }

      await archiveService.initialize();

      // Load from storage (will use IndexedDB if available, otherwise localStorage)
      await storageService.initialize();
      const data = storageService.getAllData();

      if (data.columns) {
        setColumns(data.columns);
        if (indexedDBService.isAvailable()) {
          indexedDBService.saveColumns(data.columns).catch(console.error);
        }
      }
      if (data.projectTypes) setProjectTypes(data.projectTypes);
      if (data.priorities) {
        setPriorities(data.priorities);
        if (indexedDBService.isAvailable()) {
          indexedDBService.savePriorities(data.priorities).catch(console.error);
        }
      }
      if (data.customFields) {
        setCustomFields(data.customFields);
        if (indexedDBService.isAvailable()) {
          indexedDBService.saveCustomFields(data.customFields).catch(console.error);
        }
      }
      if (data.projects) {
        setProjects(data.projects);
        if (indexedDBService.isAvailable()) {
          Promise.all(data.projects.map(p => indexedDBService.saveProject(p))).catch(console.error);
        }
      }
      if (data.tasks) {
        setTasks(data.tasks);
        // Build search index
        searchIndexService.buildIndex(data.tasks);
        // Save to IndexedDB if available
        if (indexedDBService.isAvailable()) {
          indexedDBService.saveTasks(data.tasks).catch(console.error);
        }
      }
      if (data.activeProjectId) setActiveProjectId(data.activeProjectId);
      if (data.sidebarCollapsed !== undefined) setIsSidebarCollapsed(data.sidebarCollapsed);
      if (data.grouping) setBoardGrouping(data.grouping);
      const compactView = storageService.get(STORAGE_KEYS.COMPACT_VIEW, false);
      if (compactView !== undefined) setIsCompactView(compactView);
      const showSubWorkspaceTasks = storageService.get(STORAGE_KEYS.SHOW_SUB_WORKSPACE_TASKS, false);
      if (showSubWorkspaceTasks !== undefined) setShowSubWorkspaceTasks(showSubWorkspaceTasks);
      const savedViewMode = storageService.get(STORAGE_KEYS.VIEW_MODE, 'board');
      if (savedViewMode) setViewMode(savedViewMode as 'board' | 'gantt' | 'stats' | 'calendar');
      const savedCurrentView = storageService.get(STORAGE_KEYS.CURRENT_VIEW, 'project');
      if (savedCurrentView) setCurrentView(savedCurrentView as 'project' | 'dashboard' | 'gantt');

      // Load automation rules
      const savedRules = storageService.get('liquitask-automation-rules', []);
      automationService.loadRules(savedRules);

      // Load templates
      const savedTemplates = storageService.get('liquitask-templates', []);
      templateService.loadTemplates(savedTemplates);

      setIsLoaded(true);
    };
    loadData();
  }, []);





  // Initialize notification service for due/overdue task alerts
  useEffect(() => {
    if (isLoaded) {
      notificationService.startPeriodicCheck(() => tasks, 60000); // Check every minute
      return () => notificationService.stopPeriodicCheck();
    }
  }, [isLoaded, tasks]);

  // Initialize recurring task service
  useEffect(() => {
    if (isLoaded) {
      // Initialize service if not already initialized
      const service = getRecurringTaskService();
      if (!service) {
        initializeRecurringTaskService({
          onCreateTask: (newTask: Task) => {
            pushUndo({ type: 'task-create', taskId: newTask.id });
            setTasks(prev => [...prev, newTask]);
            addToast(`Recurring task "${newTask.title}" created`, 'info');
          },
          onUpdateTask: (taskId: string, updates: Partial<Task>) => {
            setTasks(prev => prev.map(t =>
              t.id === taskId ? { ...t, ...updates, updatedAt: new Date() } : t
            ));
          },
        });
      }

      // Start scheduler with current tasks
      const currentService = getRecurringTaskService();
      if (currentService) {
        currentService.start(tasks);
      }

      return () => {
        const currentService = getRecurringTaskService();
        if (currentService) {
          currentService.stop();
        }
      };
    }
  }, [isLoaded, tasks, addToast, pushUndo]);

  const { matches } = useKeybinding();

  // Saved Views
  const {
    views,
    activeViewId,
    createView,
    applyView,
    deleteView,
  } = useSavedViews();

  const handleApplyView = (id: string) => {
    const view = applyView(id);
    if (view) {
      setFilters(view.filters);
      setBoardGrouping(view.grouping);
      setActiveFilterGroup((view.advancedFilter as FilterGroup) || { id: 'root', operator: 'AND', rules: [] });
      addToast(`View "${view.name}" applied`, 'info');
    }
  };

  const handleCreateView = (name: string) => {
    createView(name, filters, boardGrouping, activeFilterGroup);
    addToast(`View "${name}" saved`, 'success');
  };
  // ... existing state

  // ... (rest of the file until the useEffect)

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);

      // Command Palette
      if (matches('global:command-palette', e)) {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
      // Toggle Sidebar
      if (matches('global:toggle-sidebar', e)) {
        e.preventDefault();
        setIsSidebarCollapsed(prev => !prev);
      }
      // Undo
      if (matches('global:undo', e) && !isInput) {
        e.preventDefault();
        handleUndo();
      }
      // Export
      if (matches('global:export', e) && !isInput) {
        e.preventDefault();
        const projectMap = new Map<string, string>(projects.map(p => [p.id, p.name]));
        exportService.downloadCSV(tasks, 'liquitask-export.csv', projectMap);
        addToast('Exported tasks to CSV', 'success');
      }
      // Close command palette / Escape
      if (matches('nav:back', e) && isCommandPaletteOpen) {
        e.preventDefault();
        setIsCommandPaletteOpen(false);
      }
      // Create Task
      if (matches('global:create-task', e) && !isInput) {
        e.preventDefault();
        setEditingTask(null);
        setIsTaskModalOpen(true);
      }
      // Focus Search
      if (matches('global:search-focus', e) && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleUndo, isCommandPaletteOpen, tasks, projects, addToast, matches]);

  // --- Derived Data ---
  const activeProject: Project = projects.find(p => p.id === activeProjectId) || projects[0] || { name: 'No Project', id: 'temp', type: 'default' };

  // Helper function to get all sub-workspace IDs recursively
  const getAllSubWorkspaceIds = useCallback((projectId: string): string[] => {
    const subWorkspaceIds: string[] = [];
    const directChildren = projects.filter(p => p.parentId === projectId);

    for (const child of directChildren) {
      subWorkspaceIds.push(child.id);
      // Recursively get grandchildren
      const grandchildren = getAllSubWorkspaceIds(child.id);
      subWorkspaceIds.push(...grandchildren);
    }

    return subWorkspaceIds;
  }, [projects]);

  // Update search index when tasks change
  useEffect(() => {
    if (isLoaded && tasks.length > 0) {
      searchIndexService.buildIndex(tasks);
    }
  }, [isLoaded, tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Text Search - Use indexed search for better performance
    if (searchQuery.trim()) {
      // Check if query looks like regex (starts and ends with /)
      const regexMatch = searchQuery.match(/^\/(.+)\/([gimuy]*)$/);
      if (regexMatch) {
        const [, pattern] = regexMatch;
        try {
          const matchedIds = searchIndexService.searchWithRegex(pattern);
          result = result.filter(t => matchedIds.includes(t.id));
        } catch (e) {
          // Invalid regex, fall back to normal search
          const matchedIds = searchIndexService.search(searchQuery);
          result = result.filter(t => matchedIds.includes(t.id));
        }
      } else {
        // Normal indexed search
        const matchedIds = searchIndexService.search(searchQuery);
        result = result.filter(t => matchedIds.includes(t.id));
      }
    }

    // Advanced Filters
    if (filters.assignee) {
      result = result.filter(t => t.assignee.toLowerCase().includes(filters.assignee.toLowerCase()));
    }
    if (filters.tags) {
      result = result.filter(t => t.subtitle.toLowerCase().includes(filters.tags.toLowerCase()));
    }
    if (filters.dateRange && filters.startDate && filters.endDate) {
      const start = new Date(filters.startDate).getTime();
      const end = new Date(filters.endDate).getTime();
      result = result.filter(t => {
        const targetDate = filters.dateRange === 'created' ? t.createdAt : t.dueDate;
        if (!targetDate) return false;
        const time = targetDate.getTime();
        return time >= start && time <= end;
      });
    }

    // Power User Query Engine
    if (activeFilterGroup.rules.length > 0) {
      result = executeAdvancedFilter(result, activeFilterGroup);
    }

    return result;
  }, [tasks, searchQuery, filters, activeFilterGroup]);

  const currentProjectTasks = useMemo(() => {
    if (showSubWorkspaceTasks) {
      const subWorkspaceIds = getAllSubWorkspaceIds(activeProjectId);
      const allProjectIds = [activeProjectId, ...subWorkspaceIds];
      return filteredTasks.filter(t => allProjectIds.includes(t.projectId));
    }
    return filteredTasks.filter(t => t.projectId === activeProjectId);
  }, [filteredTasks, activeProjectId, showSubWorkspaceTasks, getAllSubWorkspaceIds]);

  // Helper to filter tasks by status and optional priority (for swimlanes)
  const getTasksByContext = (statusId: string, priorityId?: string) => {
    return currentProjectTasks
      .filter(task => {
        const statusMatch = task.status === statusId;
        const priorityMatch = priorityId ? task.priority === priorityId : true;
        return statusMatch && priorityMatch;
      })
      .sort((a, b) => {
        // Sort by order if available, otherwise by creation date
        const orderA = a.order ?? a.createdAt.getTime();
        const orderB = b.order ?? b.createdAt.getTime();
        return orderA - orderB;
      });
  };

  // --- Handlers ---

  const handleImportData = (data: {
    projects?: Project[];
    tasks?: Task[];
    columns?: BoardColumn[];
    projectTypes?: ProjectType[];
    priorities?: PriorityDefinition[];
    customFields?: CustomFieldDefinition[];
  }) => {
    if (data.projects) setProjects(data.projects);
    if (data.tasks) setTasks(data.tasks);
    if (data.columns) setColumns(data.columns);
    if (data.projectTypes) setProjectTypes(data.projectTypes);
    if (data.priorities) setPriorities(data.priorities);
    if (data.customFields) setCustomFields(data.customFields);
    if (data.projects && data.projects.length > 0) setActiveProjectId(data.projects[0].id);
  };

  const handleUpdateColumns = (newColumns: BoardColumn[]) => {
    try {
      // Defensive check: Ensure newColumns is an array
      if (!Array.isArray(newColumns)) {
        console.error('CRITICAL ERROR: handleUpdateColumns received invalid data', {
          timestamp: new Date().toISOString(),
          userId: 'current-user', // In a real app, this would be the actual user ID
          targetObject: newColumns,
          type: typeof newColumns,
          trigger: 'Settings Saved - Board Columns Update'
        });
        addToast('Failed to update columns: Invalid data received', 'error');
        return;
      }

      // Check for orphaned tasks
      const newColumnIds = new Set(newColumns.map(c => c.id));
      setTasks(prevTasks => {
        let hasChanges = false;
        const updatedTasks = prevTasks.map(t => {
          if (!newColumnIds.has(t.status)) {
            // Determine fallback status (first column or a default)
            const fallbackCall = newColumns.length > 0 ? newColumns[0].id : 'Pending';
            if (t.status !== fallbackCall) {
              hasChanges = true;
              const updatedTask = { ...t, status: fallbackCall };
              // Save to IndexedDB if available
              if (indexedDBService.isAvailable()) {
                indexedDBService.saveTask(updatedTask).catch(console.error);
              }
              return updatedTask;
            }
          }
          return t;
        });
        return hasChanges ? updatedTasks : prevTasks;
      });
      setColumns(newColumns);

      // Save to IndexedDB if available
      if (indexedDBService.isAvailable()) {
        indexedDBService.saveColumns(newColumns).catch(console.error);
      }
    } catch (error) {
      console.error('CRITICAL ERROR in handleUpdateColumns:', error);
      console.error('Stack Trace:', (error as Error).stack);
      addToast('An error occurred while updating columns. Check console for details.', 'error');
    }
  };

  const handleUpdateProjectTypes = (newTypes: ProjectType[]) => {
    setProjectTypes(newTypes);
  };

  const handleUpdatePriorities = (newPriorities: PriorityDefinition[]) => {
    try {
      // Defensive check: Ensure newPriorities is an array
      if (!Array.isArray(newPriorities)) {
        console.error('CRITICAL ERROR: handleUpdatePriorities received invalid data', {
          timestamp: new Date().toISOString(),
          userId: 'current-user',
          targetObject: newPriorities,
          type: typeof newPriorities,
          trigger: 'Settings Saved - Priorities Update'
        });
        addToast('Failed to update priorities: Invalid data received', 'error');
        return;
      }

      // Check for orphaned tasks
      const newPriorityIds = new Set(newPriorities.map(p => p.id));
      setTasks(prevTasks => {
        let hasChanges = false;
        const updatedTasks = prevTasks.map(t => {
          if (!newPriorityIds.has(t.priority)) {
            const fallbackPrio = newPriorities.length > 0 ? newPriorities[0].id : 'medium';
            if (t.priority !== fallbackPrio) {
              hasChanges = true;
              return { ...t, priority: fallbackPrio };
            }
          }
          return t;
        });
        return hasChanges ? updatedTasks : prevTasks;
      });
      setPriorities(newPriorities);

      // Save to IndexedDB if available
      if (indexedDBService.isAvailable()) {
        indexedDBService.savePriorities(newPriorities).catch(console.error);
      }
    } catch (error) {
      console.error('CRITICAL ERROR in handleUpdatePriorities:', error);
      console.error('Stack Trace:', (error as Error).stack);
      addToast('An error occurred while updating priorities. Check console for details.', 'error');
    }
  };

  const handleUpdateCustomFields = (newFields: CustomFieldDefinition[]) => {
    setCustomFields(newFields);

    // Save to IndexedDB if available
    if (indexedDBService.isAvailable()) {
      indexedDBService.saveCustomFields(newFields).catch(console.error);
    }
  }

  // Direct task update (for inline edits)
  const handleUpdateTask = (updatedTask: Task) => {
    const previousTask = tasks.find(t => t.id === updatedTask.id);
    const taskWithUpdatedTime = {
      ...updatedTask,
      updatedAt: new Date(),
    };
    if (previousTask) {
      pushUndo({ type: 'task-update', task: taskWithUpdatedTime, previousState: previousTask });
    }
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? taskWithUpdatedTime : t));
  };

  // Update task due date (for calendar drag-and-drop)
  const handleUpdateTaskDueDate = useCallback((taskId: string, newDate: Date) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      addToast('Task not found', 'error');
      return;
    }

    // Normalize date to start of day
    const normalizedDate = new Date(newDate);
    normalizedDate.setHours(0, 0, 0, 0);

    // Check if date actually changed
    const currentDueDate = task.dueDate ? new Date(task.dueDate) : null;
    if (currentDueDate) {
      currentDueDate.setHours(0, 0, 0, 0);
      if (currentDueDate.getTime() === normalizedDate.getTime()) {
        return; // No change needed
      }
    }

    const previousTask = { ...task };
    const updates: Partial<Task> = {
      dueDate: normalizedDate,
      updatedAt: new Date(),
    };

    // Log activity
    const updatedTask = activityService.logChange(task, updates);

    pushUndo({ type: 'task-update', task: updatedTask, previousState: previousTask });
    setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

    const dateStr = normalizedDate.toLocaleDateString();
    addToast(`Due date updated to ${dateStr}`, 'success');
  }, [tasks, addToast, pushUndo]);

  // Move task to a different workspace
  const handleMoveTaskToWorkspace = useCallback((taskId: string, projectId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const targetProject = projects.find(p => p.id === projectId);
    if (!targetProject) return;

    if (task.projectId === projectId) {
      addToast('Task is already in this workspace', 'info');
      return;
    }

    const previousTask = { ...task };
    const updatedTask = {
      ...task,
      projectId: projectId,
      updatedAt: new Date(),
    };

    pushUndo({ type: 'task-update', task: updatedTask, previousState: previousTask });
    setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
    addToast(`Task moved to "${targetProject.name}"`, 'success');
  }, [tasks, projects, addToast, pushUndo]);

  const handleCreateOrUpdateTask = (taskData: Partial<Task>) => {
    if (editingTask) {
      const previousTask = tasks.find(t => t.id === editingTask.id);

      // Calculate updates and activity
      const updates = { ...taskData, updatedAt: new Date() };
      let updatedTask = activityService.logChange(editingTask, updates);

      // Process automation rules
      const automationUpdates = automationService.processTaskEvent(
        'onUpdate',
        { previousTask, newTask: updatedTask, changedFields: Object.keys(updates) },
        tasks
      );
      if (automationUpdates) {
        updatedTask = { ...updatedTask, ...automationUpdates };
      }

      if (previousTask) {
        pushUndo({ type: 'task-update', task: updatedTask, previousState: previousTask });
      }
      setTasks(prev => prev.map(t => (t.id === editingTask.id ? updatedTask : t)));

      // Update search index
      searchIndexService.updateTask(updatedTask, previousTask);

      // If task has recurring config and was just enabled, calculate next occurrence
      const recurringService = getRecurringTaskService();
      if (updatedTask.recurring?.enabled && recurringService) {
        if (!updatedTask.recurring.nextOccurrence) {
          const nextOccurrence = recurringService.calculateNextOccurrence(updatedTask.recurring);
          setTasks(prev => prev.map(t =>
            t.id === updatedTask.id
              ? { ...t, recurring: { ...t.recurring!, nextOccurrence } }
              : t
          ));
        }
      }

      addToast('Task updated successfully', 'success');
    } else {
      const now = new Date();
      const newTask: Task = {
        ...(taskData as Task),
        id: `task-${Date.now()}`,
        jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
        projectId: activeProjectId,
        title: taskData.title || 'Untitled',
        status: taskData.status || columns[0]?.id || 'Pending',
        createdAt: now,
        updatedAt: now,
        subtasks: taskData.subtasks || [],
        attachments: taskData.attachments || [],
        customFieldValues: taskData.customFieldValues || {},
        links: taskData.links || [],
        tags: taskData.tags || [],
        timeEstimate: taskData.timeEstimate || 0,
        timeSpent: taskData.timeSpent || 0,
        errorLogs: taskData.errorLogs || [],
        activity: [activityService.createActivity('create', 'Task created')],
        recurring: taskData.recurring,
      };

      // If recurring is enabled, calculate next occurrence
      const recurringService = getRecurringTaskService();
      if (newTask.recurring?.enabled && recurringService && !newTask.recurring.nextOccurrence) {
        newTask.recurring.nextOccurrence = recurringService.calculateNextOccurrence(newTask.recurring);
      }

      // Process automation rules for new task
      const automationUpdates = automationService.processTaskEvent(
        'onCreate',
        { newTask },
        tasks
      );
      if (automationUpdates) {
        Object.assign(newTask, automationUpdates);
      }

      pushUndo({ type: 'task-create', taskId: newTask.id });
      setTasks(prev => [...prev, newTask]);

      // Update search index
      searchIndexService.updateTask(newTask);

      // Save to IndexedDB if available
      if (indexedDBService.isAvailable()) {
        indexedDBService.saveTask(newTask).catch(console.error);
      }

      addToast('Task created successfully (Ctrl+Z to undo)', 'success');
    }
    setEditingTask(null);
  };

  // Bulk create tasks (for JSON import)
  const handleBulkCreateTasks = (newTasksData: Partial<Task>[]) => {
    const now = new Date();
    const createdTasks = newTasksData.map((taskData, idx) => ({
      ...taskData,
      id: `task-${Date.now()}-${idx}`,
      jobId: `IMP-${Math.floor(Math.random() * 9000) + 1000}`,
      projectId: activeProjectId,
      title: taskData.title || 'Untitled',
      subtitle: taskData.subtitle || '',
      summary: taskData.summary || '',
      assignee: taskData.assignee || '',
      priority: taskData.priority || 'medium',
      status: columns[0]?.id || 'Pending',
      createdAt: now,
      updatedAt: now,
      subtasks: taskData.subtasks || [],
      attachments: [],
      customFieldValues: {},
      links: [],
      tags: taskData.tags || [],
      timeEstimate: taskData.timeEstimate || 0,
      timeSpent: 0,
      errorLogs: taskData.errorLogs || [],
    } as Task));

    setTasks(prev => [...prev, ...createdTasks]);

    // Save to IndexedDB if available
    if (indexedDBService.isAvailable()) {
      indexedDBService.saveTasks(createdTasks).catch(console.error);
    }
  };

  const handleEditTaskClick = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleDeleteTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const confirmed = await confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? Press Ctrl+Z to undo.',
      confirmText: 'Delete Task',
      variant: 'danger'
    });

    if (confirmed) {
      pushUndo({ type: 'task-delete', task });
      setTasks(prev => prev.filter(t => t.id !== taskId));

      // Remove from search index
      searchIndexService.removeTask(task);

      addToast('Task deleted (Ctrl+Z to undo)', 'info');
    }
  };

  const moveTask = (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      addToast('Task not found', 'error');
      return;
    }

    // Validate column exists
    const targetColumn = columns.find(c => c.id === newStatus);
    if (!targetColumn) {
      addToast('Invalid column', 'error');
      return;
    }

    // Dependency Blocking Check
    if (newStatus !== columns[0].id) {
      const blockedLinks = task.links?.filter(l => l.type === 'blocked-by') || [];
      for (const link of blockedLinks) {
        const blocker = tasks.find(t => t.id === link.targetTaskId);
        // Check if blocker exists and is NOT in a completed column
        if (blocker) {
          const blockerCol = columns.find(c => c.id === blocker.status);
          // Rule: You can't start if blocker is not done.
          if (!blockerCol?.isCompleted && blocker.status !== COLUMN_STATUS.DELIVERED) {
            addToast(`Cannot start: Blocked by task ${blocker.jobId}`, 'error');
            return; // Prevent move
          }
        }
      }
    }

    // WIP Limit Check (only if moving to different column)
    if (newStatus !== task.status && targetColumn.wipLimit && targetColumn.wipLimit > 0) {
      const tasksInColumn = tasks.filter(t => t.status === newStatus && t.id !== taskId);
      if (tasksInColumn.length >= targetColumn.wipLimit) {
        addToast(`Column "${targetColumn.title}" has reached its WIP limit`, 'error');
        return;
      }
    }

    const previousTask = { ...task };

    // Calculate order if not provided
    let finalOrder = newOrder;
    if (finalOrder === undefined) {
      if (newStatus === task.status) {
        // Same column, keep existing order
        finalOrder = task.order;
      } else {
        // New column, place at end
        const tasksInNewColumn = tasks.filter(t => t.status === newStatus && t.id !== taskId);
        const maxOrder = tasksInNewColumn.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
        finalOrder = maxOrder + 1;
      }
    }

    const updates: Partial<Task> = {
      status: newStatus,
      priority: newPriority ?? task.priority,
      order: finalOrder,
      updatedAt: new Date(),
    };

    // Log the move
    const activity = [];
    if (newStatus !== task.status) {
      activity.push(activityService.createActivity('move', `Moved to ${columns.find(c => c.id === newStatus)?.title}`, 'status', task.status, newStatus));
    }
    if (newPriority && newPriority !== task.priority) {
      activity.push(activityService.createActivity('update', `Priority changed to ${newPriority}`, 'priority', task.priority, newPriority));
    }

    let updatedTask = {
      ...task,
      ...updates,
      activity: [...(task.activity || []), ...activity]
    };

    // Process automation rules for move
    const automationUpdates = automationService.processTaskEvent(
      'onMove',
      { previousTask, newTask: updatedTask },
      tasks
    );
    if (automationUpdates) {
      updatedTask = { ...updatedTask, ...automationUpdates };
    }

    // If task is moved to completed column and has recurring config, update next occurrence
    const recurringService = getRecurringTaskService();
    if (targetColumn?.isCompleted && updatedTask.recurring?.enabled && recurringService) {
      recurringService.updateNextOccurrence(updatedTask);

      // Also trigger onComplete automation
      const completeUpdates = automationService.processTaskEvent(
        'onComplete',
        { previousTask, newTask: updatedTask },
        tasks
      );
      if (completeUpdates) {
        updatedTask = { ...updatedTask, ...completeUpdates };
      }
    }

    pushUndo({ type: 'task-move', task: updatedTask, previousState: previousTask });
    setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

    // Update search index
    searchIndexService.updateTask(updatedTask, previousTask);

    // Save to IndexedDB if available
    if (indexedDBService.isAvailable()) {
      indexedDBService.saveTask(updatedTask).catch(console.error);
    }
  };

  const handleOpenAddProject = (parentId?: string) => {
    setCreatingSubProjectFor(parentId);
    setIsProjectModalOpen(true);
  }

  const handleCreateProject = (name: string, icon: string, parentId?: string) => {
    const siblings = projects.filter(p => p.parentId === parentId);
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(p => p.order || 0)) : -1;

    const newProject: Project = {
      id: `p-${Date.now()}`,
      name,
      type: 'custom', // Legacy field - use icon instead
      icon, // Direct icon key
      parentId,
      order: maxOrder + 1
    };
    setProjects(prev => [...prev, newProject]);
    if (!parentId) {
      setActiveProjectId(newProject.id);
      setCurrentView('project');
      setViewMode('board');
    }
    addToast(`Workspace "${name}" created`, 'success');
  };

  const handleDeleteProject = async (id: string) => {
    const hasChildren = projects.some(p => p.parentId === id);
    if (hasChildren) {
      addToast("Cannot delete a project that has sub-projects.", 'error');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete Workspace',
      message: 'Delete this workspace? All associated tasks will be removed.',
      confirmText: 'Delete Workspace',
      variant: 'danger'
    });

    if (confirmed) {
      const newProjects = projects.filter(p => p.id !== id);
      setProjects(newProjects);
      setTasks(prev => prev.filter(t => t.projectId !== id));
      if (activeProjectId === id) {
        setActiveProjectId(newProjects.length > 0 ? newProjects[0].id : '');
      }
      addToast('Workspace deleted', 'info');
    }
  };

  const handleTogglePin = (projectId: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id === projectId) return { ...p, pinned: !p.pinned };
      return p;
    }));
  };

  const handleMoveProject = (projectId: string, direction: 'up' | 'down') => {
    setProjects(prev => {
      const targetProject = prev.find(p => p.id === projectId);
      if (!targetProject) return prev;

      // Context: Siblings with same pinned status and same parentId
      const isPinned = !!targetProject.pinned;
      const parentId = targetProject.parentId;

      const siblings = prev.filter(p => p.parentId === parentId && !!p.pinned === isPinned);
      siblings.sort((a, b) => (a.order || 0) - (b.order || 0));

      const currentIndex = siblings.findIndex(p => p.id === projectId);
      if (currentIndex === -1) return prev;

      const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= siblings.length) return prev;

      const reordered = [...siblings];
      [reordered[currentIndex], reordered[swapIndex]] = [reordered[swapIndex], reordered[currentIndex]];

      const orderMap = new Map<string, number>();
      reordered.forEach((p, idx) => orderMap.set(p.id, idx));

      return prev.map(p => {
        if (orderMap.has(p.id)) {
          return { ...p, order: orderMap.get(p.id) };
        }
        return p;
        return p;
      });
    });
  };

  const handleEditProject = (projectId: string, newName: string, newIcon: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id === projectId) return { ...p, name: newName, icon: newIcon };
      return p;
    }));
    addToast('Workspace updated', 'success');
  };




  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <img src={logo} alt="LiquiTask" className="w-16 h-16 object-contain drop-shadow-[0_2px_8px_rgba(239,68,68,0.3)]" />
          <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
          <p className="text-slate-400">Loading LiquiTask...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-slate-200 font-sans overflow-x-auto scrollbar-hide selection:bg-red-500/30 selection:text-white ${isElectron ? 'pt-14' : ''}`}>
      {/* Electron Title Bar */}
      <TitleBar />

      <div className="fixed top-[-30%] right-[-20%] w-[1200px] h-[1200px] bg-red-950/20 rounded-full blur-[150px] pointer-events-none z-0 mix-blend-screen animate-pulse-slow"></div>
      <div className="fixed bottom-[-40%] left-[-20%] w-[1000px] h-[1000px] bg-[#2a0000]/30 rounded-full blur-[180px] pointer-events-none z-0 mix-blend-screen"></div>

      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        projectTypes={projectTypes}
        isCollapsed={isSidebarCollapsed}
        toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onSelectProject={(id) => {
          setActiveProjectId(id);
          setCurrentView('project');
          setViewMode('board');
        }}
        onAddProject={handleOpenAddProject}
        onDeleteProject={handleDeleteProject}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        currentView={currentView}
        onChangeView={(view) => {
          setCurrentView(view);
          // Preserve appropriate viewMode when switching views
          if (view === 'dashboard' && (viewMode === 'board' || viewMode === 'gantt')) {
            setViewMode('stats');
          } else if (view === 'project' && (viewMode === 'stats' || viewMode === 'calendar')) {
            setViewMode('board');
          }
        }}
        onTogglePin={handleTogglePin}
        onMoveProject={handleMoveProject}
        onEditProject={handleEditProject}
      />

      <main
        className="relative z-10 min-h-screen flex flex-col md:pl-28"
      >

        {/* Header */}
        <header
          className={`fixed top-14 z-50 px-8 rounded-3xl liquid-glass border border-white/5 shadow-xl will-change-transform overflow-hidden ${isHeaderExpanded
            ? 'py-6 max-h-[600px]'
            : 'py-3 max-h-16'
            } transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${isSidebarCollapsed
              ? 'md:left-[112px] md:right-6'
              : 'md:left-[352px] md:right-6'
            }`}
          onMouseEnter={() => setIsHeaderExpanded(true)}
          onMouseLeave={() => setIsHeaderExpanded(false)}
        >
          {/* Collapsed State: Minimal bar with project name only */}
          <div className={`flex items-center gap-4 transition-opacity duration-300 ${isHeaderExpanded ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100 h-16'
            }`}>
            <img src={logo} alt="LiquiTask" className="w-6 h-6 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] shrink-0" />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight drop-shadow-md text-glow truncate">
                  {currentView === 'dashboard'
                    ? 'Executive Dashboard'
                    : viewMode === 'gantt'
                      ? 'Gantt View'
                      : activeProject.name}
                </h2>
                {activeProject.parentId && currentView === 'project' && (
                  <span className="text-[10px] text-slate-500 border border-white/5 bg-white/5 px-1.5 rounded uppercase tracking-wider">
                    {projects.find(p => p.id === activeProject.parentId)?.name}
                  </span>
                )}
              </div>
              {currentView === 'project' && viewMode !== 'gantt' && (
                <span className="text-[10px] text-slate-400 font-medium truncate">
                  {currentProjectTasks.length} Active Tasks {activeProject.pinned && '• Pinned'}
                </span>
              )}
            </div>
            <div className="shrink-0 ml-auto flex items-center gap-2">
              <ViewSwitcher
                currentView={currentView}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                hideBoardAndGantt={true}
              />
            </div>
          </div>

          {/* Expanded State: Full header with all controls */}
          <div className={`flex flex-col gap-5 transition-opacity duration-300 ${isHeaderExpanded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
            }`}>
            {/* Row 1: Project info, ViewSwitcher, and primary actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <img src={logo} alt="LiquiTask" className="w-8 h-8 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] shrink-0" title="LiquiTask - Task Management Dashboard" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-3xl font-bold text-white tracking-tight drop-shadow-md text-glow truncate">
                    {currentView === 'dashboard'
                      ? 'Executive Dashboard'
                      : viewMode === 'gantt'
                        ? 'Gantt View'
                        : activeProject.name}
                  </h2>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {activeProject.parentId && currentView === 'project' && (
                      <span className="text-xs text-red-300/70 px-2 py-0.5 rounded-md border border-red-500/10 bg-red-500/5 shrink-0">
                        {projects.find(p => p.id === activeProject.parentId)?.name} /
                      </span>
                    )}
                    <p className="text-slate-400 text-sm font-medium">
                      {currentView === 'dashboard'
                        ? 'Cross-project Overview'
                        : viewMode === 'gantt'
                          ? 'Timeline & Dependencies'
                          : `Project Board • ${currentProjectTasks.length} Active Tasks`}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  <ViewSwitcher
                    currentView={currentView}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className={`p-2.5 rounded-xl transition-all relative group ${canUndo ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-slate-600 opacity-40 cursor-not-allowed'}`}
                  title={canUndo ? "Undo last action (Ctrl+Z) - Revert task changes, deletions, or moves" : "Undo (Ctrl+Z) - No actions to undo"}
                  aria-label="Undo last action"
                >
                  <Undo2 size={18} />
                </button>
                <button
                  onClick={() => setIsCompactView(!isCompactView)}
                  className={`p-2.5 rounded-xl transition-all relative group ${isCompactView ? 'text-red-400 bg-red-500/10 border border-red-500/20' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                  title={isCompactView ? 'Expand View - Show full task details' : 'Compact View - Show condensed task cards'}
                  aria-label={isCompactView ? 'Expand view' : 'Compact view'}
                >
                  {isCompactView ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
                </button>
                <button
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`p-2.5 rounded-xl transition-all relative group ${isFilterOpen ? 'text-red-400 bg-red-500/10 border border-red-500/20' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                  title={isFilterOpen
                    ? `Close Filters${hasActiveFilters ? ` - ${activeFilterCount} active filter${activeFilterCount !== 1 ? 's' : ''}` : ' - No filters applied'}`
                    : `Filters${hasActiveFilters ? ` - ${activeFilterCount} active filter${activeFilterCount !== 1 ? 's' : ''}` : ' - No filters applied'}`
                  }
                  aria-label={isFilterOpen ? 'Close filters panel' : 'Open filters panel'}
                  {...(isFilterOpen ? { 'aria-expanded': 'true' } : { 'aria-expanded': 'false' })}
                >
                  <Filter size={18} />
                </button>
                <button
                  className="relative p-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                  aria-label="Notifications"
                  title={notificationPermission === 'granted'
                    ? 'Notifications - Desktop alerts enabled for task reminders'
                    : notificationPermission === 'denied'
                      ? 'Notifications - Permission denied, check browser settings'
                      : 'Notifications - Click to enable desktop alerts for task reminders'
                  }
                  onClick={() => {
                    notificationService.requestPermission().then((granted) => {
                      if (granted) {
                        setNotificationPermission('granted');
                        notificationService.show({
                          title: 'Notifications Enabled',
                          body: 'You will now receive task reminders.'
                        });
                      } else {
                        setNotificationPermission('denied');
                      }
                    });
                  }}
                >
                  <Bell size={18} />
                </button>
                <LiquidButton
                  label="New Task"
                  onClick={() => {
                    setEditingTask(null);
                    setIsTaskModalOpen(true);
                  }}
                  title="New Task (C) - Create a new task quickly"
                />
              </div>
            </div>

            {/* Row 2: Search bar and secondary controls */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className={`relative flex-shrink-0 transition-all duration-300 ease-in-out ${isSearchFocused || searchQuery.length > 0
                ? 'min-w-[280px] max-w-md'
                : 'w-48'
                }`}>
                <div className="flex items-center gap-3 bg-black/30 border border-white/10 px-4 py-3 rounded-2xl text-slate-400 focus-within:border-red-500/50 focus-within:ring-2 focus-within:ring-red-500/20 focus-within:bg-black/40 transition-all shadow-lg w-full" title="Search tasks and fields - Press / to focus, Enter to search">
                  <Search size={18} className="text-slate-500 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search tasks... (Press / to focus)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => {
                      setIsSearchFocused(true);
                      setIsHeaderExpanded(true);
                    }}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim()) {
                        searchHistory.addToHistory(searchQuery.trim());
                      }
                    }}
                    className="bg-transparent border-none outline-none focus:outline-none focus-visible:outline-none text-sm w-full placeholder-slate-500 text-slate-200"
                  />
                  <button
                    onClick={() => setIsCommandPaletteOpen(true)}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all shrink-0"
                    title="Command Palette (Cmd+K) - Quick actions, navigation, and shortcuts"
                  >
                    <Command size={14} />
                  </button>
                </div>
                <SearchHistoryDropdown
                  isOpen={isSearchFocused}
                  recentSearches={searchHistory.getRecentSearches()}
                  savedSearches={searchHistory.getSavedSearches()}
                  onSelectSearch={(query) => {
                    setSearchQuery(query);
                    searchInputRef.current?.focus();
                  }}
                  onToggleSaved={searchHistory.toggleSaved}
                  onRemove={searchHistory.removeFromHistory}
                  onClearHistory={() => searchHistory.clearHistory()}
                />
              </div>

              <div className="flex items-center gap-2">
                <SavedViewControls
                  views={views}
                  activeViewId={activeViewId}
                  onApplyView={handleApplyView}
                  onCreateView={handleCreateView}
                  onDeleteView={deleteView}
                />
              </div>
            </div>

            {/* Collapsible Filter Panel */}
            <div className={`pt-4 border-t border-white/5 overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] ${isFilterOpen
              ? 'max-h-[800px] opacity-100'
              : 'max-h-0 opacity-0'
              }`}>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"><User size={10} /> Assignee</label>
                  <input type="text" value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 w-32 focus:border-red-500/50 outline-none" placeholder="Name..." />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"><Tag size={10} /> Tag</label>
                  <input type="text" value={filters.tags} onChange={(e) => setFilters({ ...filters, tags: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 w-32 focus:border-red-500/50 outline-none" placeholder="Category..." />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"><Calendar size={10} /> Date Range</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={filters.dateRange || ''}
                      onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterState['dateRange'] })}
                      className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:border-red-500/50 outline-none"
                      aria-label="Date range filter type"
                      title="Date range filter type"
                    >
                      <option value="">None</option>
                      <option value="due">Due Date</option>
                      <option value="created">Created Date</option>
                    </select>
                    {filters.dateRange && (
                      <>
                        <label className="sr-only">Start date</label>
                        <input
                          type="date"
                          value={filters.startDate}
                          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                          className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]"
                          aria-label="Start date"
                          title="Start date"
                        />
                        <span className="text-slate-500">-</span>
                        <label className="sr-only">End date</label>
                        <input
                          type="date"
                          value={filters.endDate}
                          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                          className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]"
                          aria-label="End date"
                          title="End date"
                        />
                      </>
                    )}
                  </div>
                </div>
                <button onClick={() => { setFilters({ assignee: '', dateRange: null, startDate: '', endDate: '', tags: '' }); setActiveFilterGroup({ id: 'root', operator: 'AND', rules: [] }); }} className="ml-auto text-xs text-red-400 hover:text-white underline">Clear All</button>
              </div>

              {/* Advanced Query Builder */}
              <div className="pt-4 border-t border-white/5">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">Advanced Query</h4>
                <FilterBuilder
                  rootGroup={activeFilterGroup}
                  onChange={setActiveFilterGroup}
                  customFields={customFields}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 pt-24 md:pt-24 px-6 md:px-8 pb-6 md:pb-8 overflow-x-auto overflow-y-auto scrollbar-hide bg-gradient-to-b from-transparent via-black/20 to-transparent">
          <ViewTransition
            transitionKey={`${currentView}-${activeProjectId}-${viewMode}`}
            type="fade"
            duration={400}
            className="h-full"
          >
            {currentView === 'dashboard' ? (
              <Dashboard
                tasks={filteredTasks}
                projects={projects}
                priorities={priorities}
                columns={columns}
                boardGrouping={boardGrouping}
                activeProjectId={activeProjectId}
                onEditTask={handleEditTaskClick}
                onDeleteTask={handleDeleteTask}
                onMoveTask={moveTask}
                onUpdateTask={handleUpdateTask}
                onUpdateColumns={handleUpdateColumns}
                getTasksByContext={getTasksByContext}
                isCompact={isCompactView}
                onCopyTask={(message) => addToast(message, 'success')}
                onMoveToWorkspace={handleMoveTaskToWorkspace}
                onUpdateDueDate={handleUpdateTaskDueDate}
                onCreateTask={(date) => {
                  // Create a temporary task with the date pre-filled
                  const tempTask: Task = {
                    id: `temp-${Date.now()}`,
                    jobId: '',
                    projectId: activeProjectId,
                    title: '',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: priorities[0]?.id || 'medium',
                    status: columns[0]?.id || 'Pending',
                    createdAt: new Date(),
                    dueDate: date,
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                  };
                  setEditingTask(tempTask);
                  setIsTaskModalOpen(true);
                }}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                addToast={addToast}
              />
            ) : viewMode === 'gantt' ? (
              <GanttView
                tasks={currentProjectTasks}
                columns={columns}
                priorities={priorities}
                onEditTask={handleEditTaskClick}
                onUpdateTask={handleUpdateTask}
              />
            ) : (
              <div className="pb-4 h-full w-full overflow-x-auto scrollbar-hide">
                <ProjectBoard
                  columns={columns}
                  priorities={priorities}
                  tasks={currentProjectTasks}
                  allTasks={tasks}
                  boardGrouping={boardGrouping}
                  onUpdateColumns={handleUpdateColumns}
                  onMoveTask={moveTask}
                  onEditTask={handleEditTaskClick}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTask}
                  addToast={addToast}
                  getTasksByContext={getTasksByContext}
                  isCompact={isCompactView}
                  onCopyTask={(message) => addToast(message, 'success')}
                  projectName={activeProject.name}
                  projects={projects}
                  onMoveToWorkspace={handleMoveTaskToWorkspace}
                />
              </div>
            )}
          </ViewTransition>
        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </div>

      <TaskFormModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onSubmit={handleCreateOrUpdateTask}
        initialData={editingTask}
        projectId={activeProjectId}
        priorities={priorities}
        customFields={customFields}
        availableTasks={tasks}
        columns={columns}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false);
          setCreatingSubProjectFor(undefined);
        }}
        onSubmit={handleCreateProject}
        projects={projects}
        initialParentId={creatingSubProjectFor}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        appData={{ projects, tasks, columns, projectTypes, priorities, customFields }}
        onImportData={handleImportData}
        onUpdateColumns={handleUpdateColumns}
        onUpdateProjectTypes={handleUpdateProjectTypes}
        onUpdatePriorities={handleUpdatePriorities}
        onUpdateCustomFields={handleUpdateCustomFields}
        grouping={boardGrouping}
        onUpdateGrouping={setBoardGrouping}
        addToast={addToast}
        onBulkCreateTasks={handleBulkCreateTasks}
        showSubWorkspaceTasks={showSubWorkspaceTasks}
        onUpdateShowSubWorkspaceTasks={setShowSubWorkspaceTasks}
      />

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onCreateTask={(parsedTask) => {
          // Resolve Project ID from name
          let targetProjectId = activeProjectId;
          if (parsedTask.projectName) {
            const foundProject = projects.find(p => p.name.toLowerCase() === parsedTask.projectName?.toLowerCase());
            if (foundProject) {
              targetProjectId = foundProject.id;
            } else {
              addToast(`Project "${parsedTask.projectName}" not found. Using current.`, 'info');
            }
          }

          // Create the task
          handleCreateOrUpdateTask({
            title: parsedTask.title,
            priority: parsedTask.priority,
            dueDate: parsedTask.dueDate,
            projectId: targetProjectId,
            tags: parsedTask.tags,
            timeEstimate: parsedTask.timeEstimate
          });
        }}
        actions={[
          // Task Actions
          {
            id: 'create-task',
            label: 'Create New Task',
            description: 'Add a new task to current project',
            category: 'task' as const,
            shortcut: 'C',
            action: () => { setEditingTask(null); setIsTaskModalOpen(true); },
          },
          // Project Actions
          {
            id: 'create-project',
            label: 'Create New Project',
            description: 'Add a new workspace',
            category: 'project' as const,
            action: () => setIsProjectModalOpen(true),
          },
          ...projects.slice(0, 5).map(p => ({
            id: `switch-project-${p.id}`,
            label: `Go to ${p.name}`,
            description: 'Switch to this project',
            category: 'project' as const,
            action: () => { setActiveProjectId(p.id); setCurrentView('project'); },
          })),
          // View Actions
          {
            id: 'view-dashboard',
            label: 'Open Dashboard',
            description: 'Cross-project overview',
            category: 'view' as const,
            action: () => setCurrentView('dashboard'),
          },
          {
            id: 'view-board',
            label: 'Open Project Board',
            description: 'Kanban board view',
            category: 'view' as const,
            action: () => setCurrentView('project'),
          },
          {
            id: 'view-gantt',
            label: 'Open Gantt View',
            description: 'Timeline and dependency visualization',
            category: 'view' as const,
            action: () => setCurrentView('gantt'),
          },
          {
            id: 'toggle-filters',
            label: isFilterOpen ? 'Hide Filters' : 'Show Filters',
            description: 'Toggle filter panel',
            category: 'view' as const,
            action: () => setIsFilterOpen(prev => !prev),
          },
          // Action Commands
          {
            id: 'export-csv',
            label: 'Export to CSV',
            description: 'Download all tasks as CSV',
            category: 'action' as const,
            shortcut: '⌘E',
            action: () => {
              const projectMap = new Map<string, string>(projects.map(p => [p.id, p.name]));
              exportService.downloadCSV(tasks, 'liquitask-export.csv', projectMap);
              addToast('Exported tasks to CSV', 'success');
            },
          },
          {
            id: 'open-settings',
            label: 'Open Settings',
            description: 'Configure app preferences',
            category: 'action' as const,
            action: () => setIsSettingsModalOpen(true),
          },
          {
            id: 'undo',
            label: 'Undo Last Action',
            description: 'Revert previous change',
            category: 'action' as const,
            shortcut: '⌘Z',
            action: handleUndo,
          },
        ] satisfies CommandAction[]}
      />


    </div>
  );
};

export default App;