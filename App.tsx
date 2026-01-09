import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';

import { LiquidButton } from './components/LiquidButton';
import { TaskFormModal } from './components/TaskFormModal';
import { ProjectModal } from './components/ProjectModal';
import { SettingsModal } from './components/SettingsModal';
import { Dashboard } from './components/Dashboard';
import { Toast } from './components/Toast';
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

// Initial Projects (Fallback)
const defaultProjects: Project[] = [];

// Initial Columns (Fallback)
const defaultColumns: BoardColumn[] = [
  { id: 'Pending', title: 'Pending', color: '#64748b', wipLimit: 0 },
  { id: 'InProgress', title: 'In Progress', color: '#3b82f6', wipLimit: 3 },
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





  const [currentView, setCurrentView] = useState<'project' | 'dashboard'>('project');
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

  // Initial Data Load
  useEffect(() => {
    const loadData = async () => {
      await storageService.initialize();
      const data = storageService.getAllData();

      if (data.columns) setColumns(data.columns);
      if (data.projectTypes) setProjectTypes(data.projectTypes);
      if (data.priorities) setPriorities(data.priorities);
      if (data.customFields) setCustomFields(data.customFields);
      if (data.projects) setProjects(data.projects);
      if (data.tasks) setTasks(data.tasks);
      if (data.activeProjectId) setActiveProjectId(data.activeProjectId);
      if (data.sidebarCollapsed !== undefined) setIsSidebarCollapsed(data.sidebarCollapsed);
      if (data.grouping) setBoardGrouping(data.grouping);
      const compactView = storageService.get(STORAGE_KEYS.COMPACT_VIEW, false);
      if (compactView !== undefined) setIsCompactView(compactView);
      const showSubWorkspaceTasks = storageService.get(STORAGE_KEYS.SHOW_SUB_WORKSPACE_TASKS, false);
      if (showSubWorkspaceTasks !== undefined) setShowSubWorkspaceTasks(showSubWorkspaceTasks);

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

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);

      // Cmd/Ctrl + K for Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
      // Cmd/Ctrl + B to toggle Sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed(prev => !prev);
      }
      // Cmd/Ctrl + Z for Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !isInput) {
        e.preventDefault();
        handleUndo();
      }
      // Cmd/Ctrl + E for Export (new shortcut)
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !isInput) {
        e.preventDefault();
        const projectMap = new Map<string, string>(projects.map(p => [p.id, p.name]));
        exportService.downloadCSV(tasks, 'liquitask-export.csv', projectMap);
        addToast('Exported tasks to CSV', 'success');
      }
      // Escape to close command palette
      if (e.key === 'Escape' && isCommandPaletteOpen) {
        e.preventDefault();
        setIsCommandPaletteOpen(false);
      }
      // 'C' for Create Task (if not in input)
      if (e.key.toLowerCase() === 'c' && !isInput) {
        e.preventDefault();
        setEditingTask(null);
        setIsTaskModalOpen(true);
      }
      // '/' to focus search input (if not in input)
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleUndo, isCommandPaletteOpen, tasks, projects, addToast]);

  // --- Derived Data ---
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || { name: 'No Project', id: 'temp' };

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

  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Text Search - Expanded to include Custom Fields
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(t => {
        const basicMatch = t.title.toLowerCase().includes(lowerQuery) ||
          t.jobId.toLowerCase().includes(lowerQuery) ||
          t.assignee.toLowerCase().includes(lowerQuery) ||
          t.summary.toLowerCase().includes(lowerQuery);

        // Search custom fields
        const customMatch = t.customFieldValues && Object.values(t.customFieldValues).some(val =>
          String(val).toLowerCase().includes(lowerQuery)
        );

        return basicMatch || customMatch;
      });
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

    return result;
  }, [tasks, searchQuery, filters]);

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
    return currentProjectTasks.filter(task => {
      const statusMatch = task.status === statusId;
      const priorityMatch = priorityId ? task.priority === priorityId : true;
      return statusMatch && priorityMatch;
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
              return { ...t, status: fallbackCall };
            }
          }
          return t;
        });
        return hasChanges ? updatedTasks : prevTasks;
      });
      setColumns(newColumns);
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
    } catch (error) {
      console.error('CRITICAL ERROR in handleUpdatePriorities:', error);
      console.error('Stack Trace:', (error as Error).stack);
      addToast('An error occurred while updating priorities. Check console for details.', 'error');
    }
  };

  const handleUpdateCustomFields = (newFields: CustomFieldDefinition[]) => {
    setCustomFields(newFields);
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
      const updatedTask = {
        ...editingTask,
        ...taskData,
        updatedAt: new Date(),
      } as Task;
      if (previousTask) {
        pushUndo({ type: 'task-update', task: updatedTask, previousState: previousTask });
      }
      setTasks(prev => prev.map(t => (t.id === editingTask.id ? updatedTask : t)));
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
        errorLogs: taskData.errorLogs || []
      };
      pushUndo({ type: 'task-create', taskId: newTask.id });
      setTasks(prev => [...prev, newTask]);
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
  };

  const handleEditTaskClick = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleDeleteTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (window.confirm("Are you sure you want to delete this task? Press Ctrl+Z to undo.")) {
      pushUndo({ type: 'task-delete', task });
      setTasks(prev => prev.filter(t => t.id !== taskId));
      addToast('Task deleted (Ctrl+Z to undo)', 'info');
    }
  };

  const moveTask = (taskId: string, newStatus: string, newPriority?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

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

    const previousTask = { ...task };
    const updatedTask = {
      ...task,
      status: newStatus,
      priority: newPriority || task.priority
    };

    pushUndo({ type: 'task-move', task: updatedTask, previousState: previousTask });
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return updatedTask;
      }
      return t;
    }));
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
    }
    setCurrentView('project');
    addToast(`Workspace "${name}" created`, 'success');
  };

  const handleDeleteProject = (id: string) => {
    const hasChildren = projects.some(p => p.parentId === id);
    if (hasChildren) {
      addToast("Cannot delete a project that has sub-projects.", 'error');
      return;
    }
    if (window.confirm("Delete this workspace? All associated tasks will be removed.")) {
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

  const handleRenameProject = (projectId: string, newName: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id === projectId) return { ...p, name: newName };
      return p;
    }));
    addToast('Workspace renamed', 'success');
  };




  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
          <p className="text-slate-400">Loading LiquiTask...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-slate-200 font-sans overflow-x-hidden selection:bg-red-500/30 selection:text-white ${isElectron ? 'pt-10' : ''}`}>
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
        onSelectProject={setActiveProjectId}
        onAddProject={handleOpenAddProject}
        onDeleteProject={handleDeleteProject}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        currentView={currentView}
        onChangeView={setCurrentView}
        onTogglePin={handleTogglePin}
        onMoveProject={handleMoveProject}
        onRenameProject={handleRenameProject}
      />

      <main
        className={`relative z-10 min-h-screen flex flex-col transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${isSidebarCollapsed ? 'md:pl-24' : 'md:pl-80'}`}
      >

        {/* Header */}
        <header className="px-8 py-6 flex flex-col gap-4 sticky top-4 z-30 mx-6 mt-4 rounded-3xl liquid-glass">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="text-3xl font-bold text-white tracking-tight drop-shadow-md text-glow">
                {currentView === 'dashboard' ? 'Executive Dashboard' : activeProject.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {activeProject.parentId && (
                  <span className="text-xs text-red-300/70 px-1.5 py-0.5 rounded border border-red-500/10 bg-red-500/5">
                    {projects.find(p => p.id === activeProject.parentId)?.name} /
                  </span>
                )}
                <p className="text-slate-400 text-sm font-medium">
                  {currentView === 'dashboard' ? 'Cross-project Overview' : `Project Board • ${currentProjectTasks.length} Active Tasks`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="hidden lg:flex items-center gap-3 bg-black/20 border border-white/5 px-4 py-2.5 rounded-2xl text-slate-400 w-64 focus-within:border-red-500/50 focus-within:ring-1 focus-within:ring-red-500/20 transition-all shadow-inner">
                  <Search size={18} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search... (/ for focus)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim()) {
                        searchHistory.addToHistory(searchQuery.trim());
                      }
                    }}
                    className="bg-transparent border-none outline-none text-sm w-full placeholder-slate-500 text-slate-200"
                  />
                  <button
                    onClick={() => setIsCommandPaletteOpen(true)}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    title="Command Palette (Cmd+K)"
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

              <div className="flex items-center gap-4 border-r border-white/5 pr-6 mr-2">
                <button
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className={`p-2 rounded-full transition-colors relative group ${canUndo ? 'text-slate-400 hover:text-white' : 'text-slate-600 opacity-50 cursor-not-allowed'}`}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo last action"
                >
                  <Undo2 size={20} />
                </button>
                <button
                  onClick={() => setIsCompactView(!isCompactView)}
                  className={`p-2 rounded-full transition-colors relative group ${isCompactView ? 'text-red-400 bg-red-500/10' : 'text-slate-400 hover:text-white'}`}
                  title={isCompactView ? 'Expand View' : 'Compact View'}
                  aria-label={isCompactView ? 'Expand view' : 'Compact view'}
                >
                  {isCompactView ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
                </button>
                <button
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`p-2 rounded-full transition-colors relative group ${isFilterOpen ? 'text-red-400 bg-red-500/10' : 'text-slate-400 hover:text-white'}`}
                  title="Filters"
                  aria-label={isFilterOpen ? 'Close filters panel' : 'Open filters panel'}
                  aria-expanded={isFilterOpen}
                >
                  <Filter size={20} />
                </button>
                <button
                  className="relative p-2 text-slate-400 hover:text-white transition-colors"
                  aria-label="Notifications"
                  title="Notifications"
                >
                  <Bell size={20} />
                </button>
              </div>

              <LiquidButton
                label="New Task"
                onClick={() => {
                  setEditingTask(null);
                  setIsTaskModalOpen(true);
                }}
              />
            </div>
          </div>

          {/* Collapsible Filter Panel */}
          {isFilterOpen && (
            <div className="pt-4 border-t border-white/5 animate-in slide-in-from-top-2 fade-in">
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
                    <select value={filters.dateRange || ''} onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterState['dateRange'] })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:border-red-500/50 outline-none">
                      <option value="">None</option>
                      <option value="due">Due Date</option>
                      <option value="created">Created Date</option>
                    </select>
                    {filters.dateRange && (
                      <>
                        <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]" />
                        <span className="text-slate-500">-</span>
                        <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]" />
                      </>
                    )}
                  </div>
                </div>
                <button onClick={() => setFilters({ assignee: '', dateRange: null, startDate: '', endDate: '', tags: '' })} className="ml-auto text-xs text-red-400 hover:text-white underline">Clear Filters</button>
              </div>
            </div>
          )}
        </header>

        {/* Main Content Area */}
        <div className="flex-1 p-6 md:p-8 overflow-x-auto">

          {currentView === 'dashboard' ? (
            <Dashboard
              tasks={filteredTasks}
              projects={projects}
              priorities={priorities}
              onEditTask={handleEditTaskClick}
              onDeleteTask={handleDeleteTask}
              onMoveTask={moveTask}
              onUpdateTask={handleUpdateTask}
              isCompact={isCompactView}
              onCopyTask={(message) => addToast(message, 'success')}
              onMoveToWorkspace={handleMoveTaskToWorkspace}
            />
          ) : (
            <div className="pb-4 min-w-[1200px] h-full">
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
                getTasksByContext={getTasksByContext}
                isCompact={isCompactView}
                onCopyTask={(message) => addToast(message, 'success')}
                projectName={activeProject.name}
                projects={projects}
                onMoveToWorkspace={handleMoveTaskToWorkspace}
              />
            </div>
          )}
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