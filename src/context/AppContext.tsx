import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { Task, Project, BoardColumn, ProjectType, PriorityDefinition, CustomFieldDefinition, ToastMessage, ToastType, GroupingOption, FilterState } from '../../types';

// State interface
interface AppState {
    // Data
    columns: BoardColumn[];
    projectTypes: ProjectType[];
    priorities: PriorityDefinition[];
    customFields: CustomFieldDefinition[];
    projects: Project[];
    tasks: Task[];

    // UI State
    activeProjectId: string;
    isSidebarCollapsed: boolean;
    boardGrouping: GroupingOption;
    currentView: 'project' | 'dashboard';
    searchQuery: string;
    isFilterOpen: boolean;
    filters: FilterState;

    // Modals
    isTaskModalOpen: boolean;
    editingTask: Task | null;
    isProjectModalOpen: boolean;
    creatingSubProjectFor?: string;
    isSettingsModalOpen: boolean;

    // UI Feedback
    toasts: ToastMessage[];
    isLoaded: boolean;
}

// Action types
type AppAction =
    | { type: 'SET_LOADED'; payload: boolean }
    | { type: 'SET_COLUMNS'; payload: BoardColumn[] }
    | { type: 'SET_PROJECT_TYPES'; payload: ProjectType[] }
    | { type: 'SET_PRIORITIES'; payload: PriorityDefinition[] }
    | { type: 'SET_CUSTOM_FIELDS'; payload: CustomFieldDefinition[] }
    | { type: 'SET_PROJECTS'; payload: Project[] }
    | { type: 'SET_TASKS'; payload: Task[] }
    | { type: 'SET_ACTIVE_PROJECT'; payload: string }
    | { type: 'TOGGLE_SIDEBAR' }
    | { type: 'SET_GROUPING'; payload: GroupingOption }
    | { type: 'SET_VIEW'; payload: 'project' | 'dashboard' }
    | { type: 'SET_SEARCH_QUERY'; payload: string }
    | { type: 'TOGGLE_FILTER' }
    | { type: 'SET_FILTERS'; payload: FilterState }
    | { type: 'OPEN_TASK_MODAL'; payload?: Task }
    | { type: 'CLOSE_TASK_MODAL' }
    | { type: 'OPEN_PROJECT_MODAL'; payload?: string }
    | { type: 'CLOSE_PROJECT_MODAL' }
    | { type: 'OPEN_SETTINGS_MODAL' }
    | { type: 'CLOSE_SETTINGS_MODAL' }
    | { type: 'ADD_TOAST'; payload: ToastMessage }
    | { type: 'REMOVE_TOAST'; payload: string }
    | { type: 'ADD_TASK'; payload: Task }
    | { type: 'UPDATE_TASK'; payload: Task }
    | { type: 'DELETE_TASK'; payload: string }
    | { type: 'ADD_PROJECT'; payload: Project }
    | { type: 'DELETE_PROJECT'; payload: string }
    | { type: 'LOAD_ALL_DATA'; payload: Partial<AppState> };

// Initial state
const initialState: AppState = {
    columns: [],
    projectTypes: [],
    priorities: [],
    customFields: [],
    projects: [],
    tasks: [],
    activeProjectId: '',
    isSidebarCollapsed: false,
    boardGrouping: 'none',
    currentView: 'project',
    searchQuery: '',
    isFilterOpen: false,
    filters: {
        assignee: '',
        dateRange: null,
        startDate: '',
        endDate: '',
        tags: ''
    },
    isTaskModalOpen: false,
    editingTask: null,
    isProjectModalOpen: false,
    creatingSubProjectFor: undefined,
    isSettingsModalOpen: false,
    toasts: [],
    isLoaded: false
};

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'SET_LOADED':
            return { ...state, isLoaded: action.payload };
        case 'SET_COLUMNS':
            return { ...state, columns: action.payload };
        case 'SET_PROJECT_TYPES':
            return { ...state, projectTypes: action.payload };
        case 'SET_PRIORITIES':
            return { ...state, priorities: action.payload };
        case 'SET_CUSTOM_FIELDS':
            return { ...state, customFields: action.payload };
        case 'SET_PROJECTS':
            return { ...state, projects: action.payload };
        case 'SET_TASKS':
            return { ...state, tasks: action.payload };
        case 'SET_ACTIVE_PROJECT':
            return { ...state, activeProjectId: action.payload };
        case 'TOGGLE_SIDEBAR':
            return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed };
        case 'SET_GROUPING':
            return { ...state, boardGrouping: action.payload };
        case 'SET_VIEW':
            return { ...state, currentView: action.payload };
        case 'SET_SEARCH_QUERY':
            return { ...state, searchQuery: action.payload };
        case 'TOGGLE_FILTER':
            return { ...state, isFilterOpen: !state.isFilterOpen };
        case 'SET_FILTERS':
            return { ...state, filters: action.payload };
        case 'OPEN_TASK_MODAL':
            return { ...state, isTaskModalOpen: true, editingTask: action.payload || null };
        case 'CLOSE_TASK_MODAL':
            return { ...state, isTaskModalOpen: false, editingTask: null };
        case 'OPEN_PROJECT_MODAL':
            return { ...state, isProjectModalOpen: true, creatingSubProjectFor: action.payload };
        case 'CLOSE_PROJECT_MODAL':
            return { ...state, isProjectModalOpen: false, creatingSubProjectFor: undefined };
        case 'OPEN_SETTINGS_MODAL':
            return { ...state, isSettingsModalOpen: true };
        case 'CLOSE_SETTINGS_MODAL':
            return { ...state, isSettingsModalOpen: false };
        case 'ADD_TOAST':
            return { ...state, toasts: [...state.toasts, action.payload] };
        case 'REMOVE_TOAST':
            return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };
        case 'ADD_TASK':
            return { ...state, tasks: [...state.tasks, action.payload] };
        case 'UPDATE_TASK':
            return { ...state, tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t) };
        case 'DELETE_TASK':
            return { ...state, tasks: state.tasks.filter(t => t.id !== action.payload) };
        case 'ADD_PROJECT':
            return { ...state, projects: [...state.projects, action.payload] };
        case 'DELETE_PROJECT':
            return {
                ...state,
                projects: state.projects.filter(p => p.id !== action.payload),
                tasks: state.tasks.filter(t => t.projectId !== action.payload)
            };
        case 'LOAD_ALL_DATA':
            return { ...state, ...action.payload, isLoaded: true };
        default:
            return state;
    }
}

// Context
interface AppContextValue {
    state: AppState;
    dispatch: React.Dispatch<AppAction>;
    // Convenience actions
    addToast: (message: string, type: ToastType) => void;
    removeToast: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// Provider
interface AppProviderProps {
    children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
    const [state, dispatch] = useReducer(appReducer, initialState);

    const addToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Date.now().toString();
        dispatch({ type: 'ADD_TOAST', payload: { id, message, type } });
    }, []);

    const removeToast = useCallback((id: string) => {
        dispatch({ type: 'REMOVE_TOAST', payload: id });
    }, []);

    const value: AppContextValue = {
        state,
        dispatch,
        addToast,
        removeToast
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

// Hook
export function useAppContext() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
}

// Selectors
export function useActiveProject() {
    const { state } = useAppContext();
    return state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
}

export function useCurrentProjectTasks() {
    const { state } = useAppContext();
    return state.tasks.filter(t => t.projectId === state.activeProjectId);
}

export function useFilteredTasks() {
    const { state } = useAppContext();
    const { tasks, searchQuery, filters } = state;

    let result = tasks;

    // Text Search
    if (searchQuery.trim()) {
        const lowerQuery = searchQuery.toLowerCase();
        result = result.filter(t => {
            const basicMatch = t.title.toLowerCase().includes(lowerQuery) ||
                t.jobId.toLowerCase().includes(lowerQuery) ||
                t.assignee.toLowerCase().includes(lowerQuery) ||
                t.summary.toLowerCase().includes(lowerQuery);

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
}

export { AppContext };
export type { AppState, AppAction };
