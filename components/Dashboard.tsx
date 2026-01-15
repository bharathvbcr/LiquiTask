import React, { useState } from 'react';
import { Task, Project, PriorityDefinition, BoardColumn, GroupingOption } from '../types';
import { TaskCard } from './TaskCard';
import { LayoutDashboard, Layout, AlertCircle, Clock, CheckCircle2, TrendingUp, Calendar, BarChart3, GanttChart } from 'lucide-react';
import { CalendarView } from '../src/components/CalendarView';
import ProjectBoard from '../src/components/ProjectBoard';
import GanttView from '../src/components/GanttView';
import { ViewMode } from '../src/components/ViewSwitcher';
import { ViewTransition } from '../src/components/ViewTransition';
import logo from '../src/assets/logo.png';

interface DashboardProps {
    tasks: Task[];
    projects: Project[];
    priorities?: PriorityDefinition[];
    columns?: BoardColumn[];
    boardGrouping?: GroupingOption;
    activeProjectId?: string;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
    onUpdateColumns?: (cols: BoardColumn[]) => void;
    getTasksByContext?: (statusId: string, priorityId?: string) => Task[];
    isCompact?: boolean;
    onCopyTask?: (message: string) => void;
    onMoveToWorkspace?: (taskId: string, projectId: string) => void;
    onUpdateDueDate?: (taskId: string, newDate: Date) => void;
    onCreateTask?: (date: Date) => void;
    viewMode?: ViewMode;
    onViewModeChange?: (mode: ViewMode) => void;
    addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
    tasks, 
    projects, 
    priorities = [], 
    columns = [],
    boardGrouping = 'none',
    activeProjectId = '',
    onEditTask, 
    onDeleteTask, 
    onMoveTask, 
    onUpdateTask,
    onUpdateColumns,
    getTasksByContext,
    isCompact = false, 
    onCopyTask, 
    onMoveToWorkspace,
    onUpdateDueDate,
    onCreateTask,
    viewMode: externalViewMode,
    onViewModeChange,
    addToast
}) => {
    const [internalViewMode, setInternalViewMode] = useState<ViewMode>('stats');
    const viewMode = externalViewMode !== undefined ? externalViewMode : internalViewMode;
    const setViewMode = onViewModeChange || setInternalViewMode;
    const getTaskPriorityLevel = (task: Task) => {
        const p = priorities.find(p => p.id === task.priority);
        return p ? p.level : 99;
    };

    const highPriorityTasks = tasks
        .filter(t => {
            const level = getTaskPriorityLevel(t);
            return level <= 2 && t.status !== 'Delivered' && t.status !== 'Completed';
        })
        .sort((a, b) => {
            const levelA = getTaskPriorityLevel(a);
            const levelB = getTaskPriorityLevel(b);
            // Sort by priority level (ascending - lower level = higher priority)
            if (levelA !== levelB) {
                return levelA - levelB;
            }
            // If same priority, sort by due date (earlier dates first)
            if (a.dueDate && b.dueDate) {
                return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
            }
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;
            return 0;
        });

    const upcomingTasks = tasks
        .filter(t => {
            if (!t.dueDate || t.status === 'Delivered') return false;
            const today = new Date();
            const due = new Date(t.dueDate);
            const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= 3;
        })
        .sort((a, b) => {
            // First sort by priority level (ascending - lower level = higher priority)
            const levelA = getTaskPriorityLevel(a);
            const levelB = getTaskPriorityLevel(b);
            if (levelA !== levelB) {
                return levelA - levelB;
            }
            // Then sort by due date (earlier dates first)
            if (a.dueDate && b.dueDate) {
                return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
            }
            return 0;
        });

    const stats = {
        total: tasks.length,
        active: tasks.filter(t => t.status !== 'Delivered').length,
        high: highPriorityTasks.length,
        completed: tasks.filter(t => t.status === 'Delivered').length
    };

    const getProjectName = (id: string) => projects.find(p => p.id === id)?.name || 'Unknown Project';

    const handleAddTask = (date: Date) => {
        if (onCreateTask) {
            onCreateTask(date);
        } else if (onEditTask) {
            // Fallback: create a new task with the date pre-filled
            const newTask: Task = {
                id: `temp-${Date.now()}`,
                jobId: '',
                projectId: projects[0]?.id || '',
                title: '',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: priorities[0]?.id || 'medium',
                status: 'Pending',
                createdAt: new Date(),
                dueDate: date,
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };
            onEditTask(newTask);
        }
    };

    // Helper function for Board/Gantt views
    const getTasksByContextDefault = (statusId: string, priorityId?: string) => {
        return tasks
            .filter(task => {
                const statusMatch = task.status === statusId;
                const priorityMatch = priorityId ? task.priority === priorityId : true;
                return statusMatch && priorityMatch;
            })
            .sort((a, b) => {
                const orderA = a.order ?? a.createdAt.getTime();
                const orderB = b.order ?? b.createdAt.getTime();
                return orderA - orderB;
            });
    };

    const effectiveGetTasksByContext = getTasksByContext || getTasksByContextDefault;
    const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || { name: 'All Projects', id: '' };
    const currentProjectTasks = activeProjectId 
        ? tasks.filter(t => t.projectId === activeProjectId)
        : tasks;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-10">
            {/* View Toggle - Only show if not controlled externally */}
            {onViewModeChange === undefined && (
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <img src={logo} alt="LiquiTask" className="w-8 h-8 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
                        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
                    </div>
                    <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
                        <button
                            onClick={() => setViewMode('stats')}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                viewMode === 'stats'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <BarChart3 size={16} /> Stats
                        </button>
                        <button
                            onClick={() => setViewMode('calendar')}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                viewMode === 'calendar'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Calendar size={16} /> Calendar
                        </button>
                        <button
                            onClick={() => setViewMode('board')}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                viewMode === 'board'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Layout size={16} /> Board
                        </button>
                        <button
                            onClick={() => setViewMode('gantt')}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                viewMode === 'gantt'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <GanttChart size={16} /> Gantt
                        </button>
                    </div>
                </div>
            )}

            <ViewTransition
                transitionKey={viewMode}
                type="slide-up"
                duration={400}
                className="h-full"
            >
                {viewMode === 'calendar' ? (
                    <div className="h-[calc(100vh-250px)]">
                        <CalendarView
                            tasks={tasks}
                            priorities={priorities}
                            onTaskClick={onEditTask}
                            onAddTask={handleAddTask}
                            onUpdateDueDate={onUpdateDueDate}
                        />
                    </div>
                ) : viewMode === 'board' ? (
                    <div className="pb-4 h-full overflow-x-auto scrollbar-hide">
                        <div className="min-w-[1200px] h-full">
                            <ProjectBoard
                            columns={columns}
                            priorities={priorities || []}
                            tasks={currentProjectTasks}
                            allTasks={tasks}
                            boardGrouping={boardGrouping}
                            onUpdateColumns={onUpdateColumns || (() => {})}
                            onMoveTask={onMoveTask}
                            onEditTask={onEditTask}
                            onUpdateTask={onUpdateTask}
                            onDeleteTask={onDeleteTask}
                            addToast={addToast}
                            getTasksByContext={effectiveGetTasksByContext}
                            isCompact={isCompact}
                            onCopyTask={onCopyTask}
                            projectName={activeProject.name}
                            projects={projects}
                            onMoveToWorkspace={onMoveToWorkspace}
                        />
                        </div>
                    </div>
                ) : viewMode === 'gantt' ? (
                    <GanttView
                        tasks={currentProjectTasks}
                        columns={columns}
                        priorities={priorities || []}
                        onEditTask={onEditTask}
                        onUpdateTask={onUpdateTask}
                    />
                ) : (
                    <>
            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="liquid-glass p-6 relative overflow-hidden group hover:border-blue-500/30 transition-all duration-500">
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-blue-500 group-hover:scale-125 transition-transform duration-700 ease-out"><LayoutDashboard size={80} /></div>
                    <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                    <p className="text-slate-400 text-xs uppercase tracking-widest font-bold relative z-10">Active Tasks</p>
                    <h3 className="text-4xl font-bold text-white mt-2 relative z-10 text-glow">{stats.active}</h3>
                    <div className="mt-4 text-xs text-blue-400 flex items-center gap-1 font-medium relative z-10"><TrendingUp size={12} /> {Math.floor((stats.active / (stats.total || 1)) * 100)}% of total</div>
                </div>

                <div className="liquid-glass p-6 relative overflow-hidden group hover:border-red-500/30 transition-all duration-500">
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-red-500 group-hover:scale-125 transition-transform duration-700 ease-out"><AlertCircle size={80} /></div>
                    <div className="absolute inset-0 bg-red-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                    <p className="text-red-300 text-xs uppercase tracking-widest font-bold relative z-10">High Priority</p>
                    <h3 className="text-4xl font-bold text-white mt-2 relative z-10 text-glow">{stats.high}</h3>
                    <p className="mt-4 text-xs text-red-400 font-medium relative z-10">Requires attention</p>
                </div>

                <div className="liquid-glass p-6 relative overflow-hidden group hover:border-amber-500/30 transition-all duration-500">
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-amber-500 group-hover:scale-125 transition-transform duration-700 ease-out"><Clock size={80} /></div>
                    <div className="absolute inset-0 bg-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                    <p className="text-slate-400 text-xs uppercase tracking-widest font-bold relative z-10">Due Soon</p>
                    <h3 className="text-4xl font-bold text-white mt-2 relative z-10 text-glow">{upcomingTasks.length}</h3>
                    <p className="mt-4 text-xs text-amber-400 font-medium relative z-10">Next 3 days</p>
                </div>

                <div className="liquid-glass p-6 relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-500">
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-emerald-500 group-hover:scale-125 transition-transform duration-700 ease-out"><CheckCircle2 size={80} /></div>
                    <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                    <p className="text-emerald-300 text-xs uppercase tracking-widest font-bold relative z-10">Delivered</p>
                    <h3 className="text-4xl font-bold text-white mt-2 relative z-10 text-glow">{stats.completed}</h3>
                    <p className="mt-4 text-xs text-emerald-400 font-medium relative z-10">Total completed</p>
                </div>
            </div>


            {/* Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

                {/* Urgent Tasks */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.15)]"><AlertCircle size={22} /></div>
                        <h2 className="text-2xl font-bold text-white tracking-tight text-glow">Urgent Attention</h2>
                    </div>
                    <div className="space-y-6">
                        {highPriorityTasks.length === 0 ? (
                            <div className="p-10 border border-dashed border-white/10 rounded-3xl text-center text-slate-500 text-sm bg-white/5 backdrop-blur-sm">
                                No high priority tasks. Good job!
                            </div>
                        ) : (
                            highPriorityTasks.map(task => (
                                <div key={task.id} className="relative group/card transform transition-all duration-300 hover:scale-[1.01]">
                                    {/* Improved Project Pill */}
                                    <div className="absolute -top-3 left-4 z-20 flex items-center gap-2 bg-[#0a0000] border border-white/10 px-3 py-1 rounded-full shadow-lg transition-transform group-hover/card:-translate-y-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>
                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider leading-none">
                                            {getProjectName(task.projectId)}
                                        </span>
                                    </div>
                                    <TaskCard
                                        task={task}
                                        priorities={priorities}
                                        onMoveTask={onMoveTask}
                                        onEditTask={onEditTask}
                                        onDeleteTask={onDeleteTask}
                                        onUpdateTask={onUpdateTask}
                                        isCompact={isCompact}
                                        onCopyTask={onCopyTask}
                                        projectName={getProjectName(task.projectId)}
                                        projects={projects}
                                        onMoveToWorkspace={onMoveToWorkspace}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Upcoming */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]"><Clock size={22} /></div>
                        <h2 className="text-2xl font-bold text-white tracking-tight text-glow">Due Soon</h2>
                    </div>
                    <div className="space-y-6">
                        {upcomingTasks.length === 0 ? (
                            <div className="p-10 border border-dashed border-white/10 rounded-3xl text-center text-slate-500 text-sm bg-white/5 backdrop-blur-sm">
                                No upcoming deadlines in the next 3 days.
                            </div>
                        ) : (
                            upcomingTasks.map(task => (
                                <div key={task.id} className="relative group/card transform transition-all duration-300 hover:scale-[1.01]">
                                    {/* Improved Project Pill */}
                                    <div className="absolute -top-3 left-4 z-20 flex items-center gap-2 bg-[#0a0000] border border-white/10 px-3 py-1 rounded-full shadow-lg transition-transform group-hover/card:-translate-y-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>
                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider leading-none">
                                            {getProjectName(task.projectId)}
                                        </span>
                                    </div>
                                    <TaskCard
                                        task={task}
                                        priorities={priorities}
                                        onMoveTask={onMoveTask}
                                        onEditTask={onEditTask}
                                        onDeleteTask={onDeleteTask}
                                        onUpdateTask={onUpdateTask}
                                        isCompact={isCompact}
                                        onCopyTask={onCopyTask}
                                        projectName={getProjectName(task.projectId)}
                                        projects={projects}
                                        onMoveToWorkspace={onMoveToWorkspace}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>
                    </>
                )}
            </ViewTransition>
        </div>
    );
};