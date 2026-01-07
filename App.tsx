import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { TaskCard } from './components/TaskCard';
import { LiquidButton } from './components/LiquidButton';
import { TaskFormModal } from './components/TaskFormModal';
import { ProjectModal } from './components/ProjectModal';
import { SettingsModal } from './components/SettingsModal';
import { Dashboard } from './components/Dashboard';
import { Toast } from './components/Toast';
import { TitleBar } from './components/TitleBar';
import { Task, Project, BoardColumn, ProjectType, PriorityDefinition, GroupingOption, ToastMessage, ToastType, CustomFieldDefinition, FilterState } from './types';
import { Search, Bell, Filter, Calendar, Tag, User, AlertOctagon, Undo2 } from 'lucide-react';
import { debounce } from './src/utils/debounce';

// Initial Projects (Fallback)
const defaultProjects: Project[] = [
  { id: 'p1', name: 'Daily Operations', type: 'folder', order: 0 },
  { id: 'p2', name: 'Web Development', type: 'dev', order: 1 },
  { id: 'p3', name: 'Marketing Q4', type: 'marketing', order: 2 },
  { id: 'p4', name: 'Backend API', type: 'code', parentId: 'p2', order: 0 },
];

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
  // Migration helper: Migrate from old 'aether-' keys to 'liquitask-' keys
  const migrateStorageKey = <T,>(oldKey: string, newKey: string): T | null => {
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue) {
      localStorage.setItem(newKey, oldValue);
      localStorage.removeItem(oldKey);
      return JSON.parse(oldValue) as T;
    }
    return null;
  };

  const [columns, setColumns] = useState<BoardColumn[]>(() => {
    const migrated = migrateStorageKey('aether-columns', 'liquitask-columns');
    if (migrated) return migrated;
    const saved = localStorage.getItem('liquitask-columns');
    return saved ? JSON.parse(saved) : defaultColumns;
  });

  const [projectTypes, setProjectTypes] = useState<ProjectType[]>(() => {
    const migrated = migrateStorageKey('aether-project-types', 'liquitask-project-types');
    if (migrated) return migrated;
    const saved = localStorage.getItem('liquitask-project-types');
    return saved ? JSON.parse(saved) : defaultProjectTypes;
  });

  const [priorities, setPriorities] = useState<PriorityDefinition[]>(() => {
    const migrated = migrateStorageKey('aether-priorities', 'liquitask-priorities');
    if (migrated) return migrated;
    const saved = localStorage.getItem('liquitask-priorities');
    return saved ? JSON.parse(saved) : defaultPriorities;
  });

  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>(() => {
    const migrated = migrateStorageKey('aether-custom-fields', 'liquitask-custom-fields');
    if (migrated) return migrated;
    const saved = localStorage.getItem('liquitask-custom-fields');
    return saved ? JSON.parse(saved) : [];
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    const migrated = migrateStorageKey('aether-projects', 'liquitask-projects');
    if (migrated) return migrated;
    const saved = localStorage.getItem('liquitask-projects');
    return saved ? JSON.parse(saved) : defaultProjects;
  });

  const [tasks, setTasks] = useState<Task[]>(() => {
    const migrated = migrateStorageKey<unknown[]>('aether-tasks', 'liquitask-tasks');
    if (migrated) {
      return migrated.map((t: unknown): Task => {
        const task = t as Record<string, unknown>;
        return {
          ...task,
          createdAt: task.createdAt ? new Date(task.createdAt as string) : new Date(),
          dueDate: task.dueDate ? new Date(task.dueDate as string) : undefined,
          attachments: (task.attachments as Task['attachments']) || [],
          customFieldValues: (task.customFieldValues as Task['customFieldValues']) || {},
          links: (task.links as Task['links']) || [],
          tags: (task.tags as Task['tags']) || [],
          timeEstimate: (task.timeEstimate as number) || 0,
          timeSpent: (task.timeSpent as number) || 0,
        } as Task;
      });
    }
    const saved = localStorage.getItem('liquitask-tasks');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as unknown[];
        return parsed.map((t: unknown) => {
          const task = t as Record<string, unknown>;
          return {
            ...task,
            createdAt: task.createdAt ? new Date(task.createdAt as string) : new Date(),
            dueDate: task.dueDate ? new Date(task.dueDate as string) : undefined,
            attachments: (task.attachments as Task['attachments']) || [],
            customFieldValues: (task.customFieldValues as Task['customFieldValues']) || {},
            links: (task.links as Task['links']) || [],
            tags: (task.tags as Task['tags']) || [],
            timeEstimate: (task.timeEstimate as number) || 0,
            timeSpent: (task.timeSpent as number) || 0,
          } as Task;
        });
      } catch (e) {
        console.error('Failed to parse tasks:', e);
        return [];
      }
    }
    return [];
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    const migrated = migrateStorageKey('aether-active-project', 'liquitask-active-project');
    if (migrated) return migrated;
    const saved = localStorage.getItem('liquitask-active-project');
    return saved || (projects[0]?.id || 'p1');
  });

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    const migrated = migrateStorageKey('aether-sidebar-collapsed', 'liquitask-sidebar-collapsed');
    if (migrated !== null) return migrated === 'true';
    const saved = localStorage.getItem('liquitask-sidebar-collapsed');
    return saved === 'true';
  });

  const [boardGrouping, setBoardGrouping] = useState<GroupingOption>(() => {
    const migrated = migrateStorageKey('aether-grouping', 'liquitask-grouping');
    if (migrated) return migrated as GroupingOption;
    const saved = localStorage.getItem('liquitask-grouping');
    return (saved as GroupingOption) || 'none';
  });

  const [currentView, setCurrentView] = useState<'project' | 'dashboard'>('project');
  const [searchQuery, setSearchQuery] = useState('');
  const [dragOverInfo, setDragOverInfo] = useState<{ colId: string, rowId?: string } | null>(null);
  const [_draggedColumnId, setDraggedColumnId] = useState<string | null>(null);

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

  // Debounced localStorage writes
  const debouncedSaveColumns = useMemo(() => debounce((cols: BoardColumn[]) => {
    localStorage.setItem('liquitask-columns', JSON.stringify(cols));
  }, 300), []);

  const debouncedSaveProjectTypes = useMemo(() => debounce((types: ProjectType[]) => {
    localStorage.setItem('liquitask-project-types', JSON.stringify(types));
  }, 300), []);

  const debouncedSavePriorities = useMemo(() => debounce((prios: PriorityDefinition[]) => {
    localStorage.setItem('liquitask-priorities', JSON.stringify(prios));
  }, 300), []);

  const debouncedSaveCustomFields = useMemo(() => debounce((fields: CustomFieldDefinition[]) => {
    localStorage.setItem('liquitask-custom-fields', JSON.stringify(fields));
  }, 300), []);

  const debouncedSaveProjects = useMemo(() => debounce((projs: Project[]) => {
    localStorage.setItem('liquitask-projects', JSON.stringify(projs));
  }, 300), []);

  const debouncedSaveTasks = useMemo(() => debounce((tsks: Task[]) => {
    localStorage.setItem('liquitask-tasks', JSON.stringify(tsks));
  }, 300), []);

  // --- Effects ---
  useEffect(() => { debouncedSaveColumns(columns); }, [columns, debouncedSaveColumns]);
  useEffect(() => { debouncedSaveProjectTypes(projectTypes); }, [projectTypes, debouncedSaveProjectTypes]);
  useEffect(() => { debouncedSavePriorities(priorities); }, [priorities, debouncedSavePriorities]);
  useEffect(() => { debouncedSaveCustomFields(customFields); }, [customFields, debouncedSaveCustomFields]);
  useEffect(() => { debouncedSaveProjects(projects); }, [projects, debouncedSaveProjects]);
  useEffect(() => { debouncedSaveTasks(tasks); }, [tasks, debouncedSaveTasks]);
  useEffect(() => { localStorage.setItem('liquitask-active-project', activeProjectId); }, [activeProjectId]);
  useEffect(() => { localStorage.setItem('liquitask-sidebar-collapsed', String(isSidebarCollapsed)); }, [isSidebarCollapsed]);
  useEffect(() => { localStorage.setItem('liquitask-grouping', boardGrouping); }, [boardGrouping]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Cmd/Ctrl + B to toggle Sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed(prev => !prev);
      }
      // Cmd/Ctrl + Z for Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        handleUndo();
      }
      // 'C' for Create Task (if not in input)
      if (e.key.toLowerCase() === 'c' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setEditingTask(null);
        setIsTaskModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleUndo]);

  // --- Derived Data ---
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || { name: 'No Project', id: 'temp' };

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
    return filteredTasks.filter(t => t.projectId === activeProjectId);
  }, [filteredTasks, activeProjectId]);

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
    setColumns(newColumns);
  };

  const handleUpdateProjectTypes = (newTypes: ProjectType[]) => {
    setProjectTypes(newTypes);
  };

  const handleUpdatePriorities = (newPriorities: PriorityDefinition[]) => {
    setPriorities(newPriorities);
  };

  const handleUpdateCustomFields = (newFields: CustomFieldDefinition[]) => {
    setCustomFields(newFields);
  }

  // Direct task update (for inline edits)
  const handleUpdateTask = (updatedTask: Task) => {
    const previousTask = tasks.find(t => t.id === updatedTask.id);
    if (previousTask) {
      pushUndo({ type: 'task-update', task: updatedTask, previousState: previousTask });
    }
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  const handleCreateOrUpdateTask = (taskData: Partial<Task>) => {
    if (editingTask) {
      const previousTask = tasks.find(t => t.id === editingTask.id);
      const updatedTask = { ...editingTask, ...taskData } as Task;
      if (previousTask) {
        pushUndo({ type: 'task-update', task: updatedTask, previousState: previousTask });
      }
      setTasks(prev => prev.map(t => (t.id === editingTask.id ? updatedTask : t)));
      addToast('Task updated successfully', 'success');
    } else {
      const newTask: Task = {
        ...(taskData as Task),
        id: `task-${Date.now()}`,
        jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
        projectId: activeProjectId,
        title: taskData.title || 'Untitled',
        status: taskData.status || columns[0]?.id || 'Pending',
        createdAt: new Date(),
        subtasks: taskData.subtasks || [],
        attachments: taskData.attachments || [],
        customFieldValues: taskData.customFieldValues || {},
        links: taskData.links || [],
        tags: taskData.tags || [],
        timeEstimate: taskData.timeEstimate || 0,
        timeSpent: taskData.timeSpent || 0
      };
      pushUndo({ type: 'task-create', taskId: newTask.id });
      setTasks(prev => [...prev, newTask]);
      addToast('Task created successfully (Ctrl+Z to undo)', 'success');
    }
    setEditingTask(null);
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
          if (!blockerCol?.isCompleted && blocker.status !== 'Delivered') {
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

  const handleCreateProject = (name: string, type: string, parentId?: string) => {
    const siblings = projects.filter(p => p.parentId === parentId);
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(p => p.order || 0)) : -1;

    const newProject: Project = {
      id: `p-${Date.now()}`,
      name,
      type,
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
    if (projects.length <= 1) {
      addToast("You must have at least one active project.", 'error');
      return;
    }
    if (window.confirm("Delete this workspace? All associated tasks will be removed.")) {
      const newProjects = projects.filter(p => p.id !== id);
      setProjects(newProjects);
      setTasks(prev => prev.filter(t => t.projectId !== id));
      if (activeProjectId === id) setActiveProjectId(newProjects[0].id);
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
      });
    });
  };


  // Drag and Drop Logic for Tasks and Columns
  const handleDragOver = (e: React.DragEvent, _colId: string, _rowId?: string) => { e.preventDefault(); };
  const handleDragEnter = (colId: string, rowId?: string) => { setDragOverInfo({ colId, rowId }); };
  const handleDrop = (e: React.DragEvent, statusId: string, priorityId?: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) {
      moveTask(taskId, statusId, priorityId);
    }
    setDragOverInfo(null);
  };

  const handleColumnDragStart = (e: React.DragEvent, colId: string) => {
    setDraggedColumnId(colId);
    e.dataTransfer.setData('columnId', colId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleColumnDrop = (e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('columnId');
    if (draggedId && draggedId !== targetColId) {
      const newColumns = [...columns];
      const draggedIndex = newColumns.findIndex(c => c.id === draggedId);
      const targetIndex = newColumns.findIndex(c => c.id === targetColId);

      const [removed] = newColumns.splice(draggedIndex, 1);
      newColumns.splice(targetIndex, 0, removed);
      setColumns(newColumns);
    }
    setDraggedColumnId(null);
  }

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

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
              <div className="hidden lg:flex items-center gap-3 bg-black/20 border border-white/5 px-4 py-2.5 rounded-2xl text-slate-400 w-64 focus-within:border-red-500/50 focus-within:ring-1 focus-within:ring-red-500/20 transition-all shadow-inner">
                <Search size={18} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search tasks & fields... (Cmd+K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm w-full placeholder-slate-500 text-slate-200"
                />
              </div>

              <div className="flex items-center gap-4 border-r border-white/5 pr-6 mr-2">
                <button
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className={`p-2 rounded-full transition-colors relative group ${canUndo ? 'text-slate-400 hover:text-white' : 'text-slate-600 opacity-50 cursor-not-allowed'}`}
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 size={20} />
                </button>
                <button
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`p-2 rounded-full transition-colors relative group ${isFilterOpen ? 'text-red-400 bg-red-500/10' : 'text-slate-400 hover:text-white'}`}
                  title="Filters"
                >
                  <Filter size={20} />
                </button>
                <button className="relative p-2 text-slate-400 hover:text-white transition-colors">
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
            />
          ) : (
            <div className="pb-4 min-w-[1200px] h-full">

              {boardGrouping === 'none' && (
                <div className="flex gap-6 h-full">
                  {columns.map((column) => {
                    const columnTasks = getTasksByContext(column.id);
                    const isDragOver = dragOverInfo?.colId === column.id && !dragOverInfo?.rowId;
                    const accentColor = column.color.startsWith('#') ? column.color : '#64748b';

                    // WIP Limit Logic
                    const wipLimit = column.wipLimit || 0;
                    const isOverLimit = wipLimit > 0 && columnTasks.length > wipLimit;

                    return (
                      <div
                        key={column.id}
                        className="flex-1 flex flex-col min-w-[300px]"
                        draggable
                        onDragStart={(e) => handleColumnDragStart(e, column.id)}
                        onDrop={(e) => handleColumnDrop(e, column.id)}
                        onDragOver={(e) => e.preventDefault()}
                      >
                        <div className="flex items-center justify-between mb-4 px-4 cursor-grab active:cursor-grabbing group/colheader">
                          <div className="flex items-center gap-3">
                            <h3 className={`font-bold text-sm tracking-wide uppercase text-shadow-sm transition-colors ${isOverLimit ? 'text-red-400' : 'text-slate-200'}`}>
                              {column.title}
                            </h3>
                            <span className={`text-xs px-2 py-0.5 rounded border ${isOverLimit ? 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse' : 'bg-white/5 text-slate-400 border-white/5'}`}>
                              {columnTasks.length} {wipLimit > 0 && `/ ${wipLimit}`}
                            </span>
                            {isOverLimit && <AlertOctagon size={16} className="text-red-500 animate-pulse" />}
                          </div>
                          <div className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: isOverLimit ? '#ef4444' : accentColor, color: isOverLimit ? '#ef4444' : accentColor }}></div>
                        </div>

                        <div
                          className={`flex-1 rounded-3xl p-3 flex flex-col gap-4 transition-all duration-500 
                                            ${isDragOver ? 'bg-white/5 border-white/10 shadow-[inset_0_0_30px_rgba(255,255,255,0.05)]' : 'bg-transparent border border-transparent'}
                                            ${isOverLimit ? 'bg-red-900/10 border-red-500/20' : ''}
                                        `}
                          onDragOver={(e) => handleDragOver(e, column.id)}
                          onDrop={(e) => handleDrop(e, column.id)}
                          onDragEnter={() => handleDragEnter(column.id)}
                        >
                          <div className="h-full rounded-2xl bg-[#0a0a0a]/50 backdrop-blur-md border border-white/10 p-4 flex flex-col gap-4 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] min-h-[300px]">
                            {columnTasks.map(task => (
                              <TaskCard
                                key={task.id}
                                task={task}
                                priorities={priorities}
                                isCompletedColumn={column.isCompleted}
                                onMoveTask={moveTask}
                                onEditTask={handleEditTaskClick}
                                onUpdateTask={handleUpdateTask}
                                onDeleteTask={handleDeleteTask}
                                allTasks={tasks}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {boardGrouping === 'priority' && (
                <div className="flex flex-col gap-8">
                  <div className="flex gap-6 sticky top-0 z-20 pb-2 bg-[#020000]/80 backdrop-blur-md -mx-6 px-6 pt-2">
                    {columns.map((col) => (
                      <div key={col.id} className="flex-1 min-w-[300px] flex items-center justify-between px-2">
                        <h3 className="font-bold text-slate-300 text-xs tracking-wide uppercase">{col.title}</h3>
                      </div>
                    ))}
                  </div>

                  {priorities.map((prio) => {
                    return (
                      <div key={prio.id} className="rounded-3xl border border-white/5 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-3 mb-4 px-2">
                          <div className="h-px w-8 bg-current opacity-50" style={{ color: prio.color }}></div>
                          <span className="text-sm font-bold uppercase tracking-widest" style={{ color: prio.color }}>{prio.label}</span>
                          <div className="h-px flex-1 bg-current opacity-20" style={{ color: prio.color }}></div>
                        </div>
                        <div className="flex gap-6">
                          {columns.map((column) => {
                            const columnTasks = getTasksByContext(column.id, prio.id);
                            const isDragOver = dragOverInfo?.colId === column.id && dragOverInfo?.rowId === prio.id;
                            return (
                              <div
                                key={`${prio.id}-${column.id}`}
                                className={`flex-1 min-w-[300px] rounded-2xl transition-all duration-300 ${isDragOver ? 'bg-white/5 ring-1 ring-white/20' : ''}`}
                                onDragOver={(e) => handleDragOver(e, column.id, prio.id)}
                                onDrop={(e) => handleDrop(e, column.id, prio.id)}
                                onDragEnter={() => handleDragEnter(column.id, prio.id)}
                              >
                                <div className="flex flex-col gap-4 min-h-[120px] p-2">
                                  {columnTasks.map(task => (
                                    <TaskCard
                                      key={task.id}
                                      task={task}
                                      priorities={priorities}
                                      isCompletedColumn={column.isCompleted}
                                      onMoveTask={moveTask}
                                      onEditTask={handleEditTaskClick}
                                      onUpdateTask={handleUpdateTask}
                                      onDeleteTask={handleDeleteTask}
                                      allTasks={tasks}
                                    />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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
        projectTypes={projectTypes}
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
      />


    </div>
  );
};

export default App;