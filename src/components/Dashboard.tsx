import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  GanttChart,
  Layout,
  LayoutDashboard,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { COLUMN_STATUS } from "../constants";
import { CalendarView } from "../views/board/CalendarView";
import GanttView from "../views/board/GanttView";
import ProjectBoard from "../views/board/ProjectBoard";
import { StatCard } from "./StatCard";
import type { ViewMode } from "./ViewSwitcher";
import { ViewTransition } from "./ViewTransition";
import { buildTaskContextIndex, getTasksFromContextIndex } from "../utils/taskContextIndex";
import type {
  AISuggestion,
  BoardColumn,
  GroupingOption,
  PriorityDefinition,
  Project,
  Task,
} from "../../types";
import { TaskCard } from "./TaskCard";

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
  onArchiveTask?: (taskId: string) => void;
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
  onSuggestNextTask?: () => void;
  nextTaskSuggestion?: AISuggestion | null;
  addToast?: (message: string, type: "success" | "error" | "info") => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  tasks,
  projects,
  priorities = [],
  columns = [],
  boardGrouping = "none",
  activeProjectId = "",
  onEditTask,
  onDeleteTask,
  onArchiveTask,
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
  onSuggestNextTask,
  nextTaskSuggestion,
  addToast,
}) => {
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>("stats");
  const viewMode = externalViewMode !== undefined ? externalViewMode : internalViewMode;
  const setViewMode = onViewModeChange || setInternalViewMode;
  const priorityLevelById = useMemo(
    () => new Map(priorities.map((priority) => [priority.id, priority.level])),
    [priorities],
  );

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const getProjectName = useCallback(
    (id: string) => projectNameById.get(id) || "Unknown Project",
    [projectNameById],
  );

  const { highPriorityTasks, upcomingTasks, stats } = useMemo(() => {
    const now = new Date();
    let active = 0;
    let completed = 0;
    const highPriority: Task[] = [];
    const upcoming: Task[] = [];

    for (const task of tasks) {
      const isDelivered = task.status === COLUMN_STATUS.COMMIT;
      const isCompleted = task.status === COLUMN_STATUS.COMPLETED;
      const priorityLevel = priorityLevelById.get(task.priority) ?? 99;

      if (!isDelivered && !isCompleted) active += 1;
      if (isDelivered) completed += 1;
      if (priorityLevel <= 2 && !isDelivered && !isCompleted) {
        highPriority.push(task);
      }

      if (task.dueDate && !isDelivered && !isCompleted) {
        const due = new Date(task.dueDate);
        const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 3) {
          upcoming.push(task);
        }
      }
    }

    const compareByPriorityThenDueDate = (a: Task, b: Task) => {
      const levelA = priorityLevelById.get(a.priority) ?? 99;
      const levelB = priorityLevelById.get(b.priority) ?? 99;
      if (levelA !== levelB) return levelA - levelB;
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    };

    highPriority.sort(compareByPriorityThenDueDate);
    upcoming.sort(compareByPriorityThenDueDate);

    return {
      highPriorityTasks: highPriority,
      upcomingTasks: upcoming,
      stats: {
        total: tasks.length,
        active,
        high: highPriority.length,
        completed,
      },
    };
  }, [tasks, priorityLevelById]);

  const handleAddTask = (date: Date) => {
    if (onCreateTask) {
      onCreateTask(date);
    } else if (onEditTask) {
      // Fallback: create a new task with the date pre-filled
      const projectId = activeProjectId || projects[0]?.id || "";
      if (!projectId) {
        console.warn("handleAddTask: no valid projectId available; task will be saved with empty projectId");
      }
      const newTask: Task = {
        id: `temp-${Date.now()}`,
        jobId: "",
        projectId,
        title: "",
        subtitle: "",
        summary: "",
        assignee: "",
        priority: priorities[0]?.id || "medium",
        status: COLUMN_STATUS.TASK,
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

  const activeProject = useMemo(
    () =>
      projects.find((p) => p.id === activeProjectId) ||
      projects[0] || { name: "All Projects", id: "" },
    [activeProjectId, projects],
  );
  const currentProjectTasks = useMemo(
    () => (activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : tasks),
    [activeProjectId, tasks],
  );
  const defaultTaskContextIndex = useMemo(
    () => buildTaskContextIndex(currentProjectTasks),
    [currentProjectTasks],
  );
  const getTasksByContextDefault = useCallback(
    (statusId: string, priorityId?: string) =>
      getTasksFromContextIndex(defaultTaskContextIndex, statusId, priorityId),
    [defaultTaskContextIndex],
  );

  const effectiveGetTasksByContext = getTasksByContext || getTasksByContextDefault;

  return (
    <div className="h-full w-full space-y-6 flex flex-col">
      {/* Internal header is hidden when external view handling is used to avoid duplication */}
      {onViewModeChange === undefined && (
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
          </div>

          <div className="flex items-center gap-4">
            {onSuggestNextTask && (
              <button
                onClick={onSuggestNextTask}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-bold transition-all border border-red-500/20 shadow-glow-red/10"
              >
                <Sparkles size={16} />
                Suggest Next Task
              </button>
            )}

            <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
              <button
                onClick={() => setViewMode("stats")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "stats"
                    ? "bg-red-500/20 text-red-400"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <BarChart3 size={16} /> Stats
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "calendar"
                    ? "bg-red-500/20 text-red-400"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Calendar size={16} /> Calendar
              </button>
              <button
                onClick={() => setViewMode("board")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "board"
                    ? "bg-red-500/20 text-red-400"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Layout size={16} /> Board
              </button>
              <button
                onClick={() => setViewMode("gantt")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "gantt"
                    ? "bg-red-500/20 text-red-400"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <GanttChart size={16} /> Gantt
              </button>
            </div>
          </div>
        </div>
      )}

      {nextTaskSuggestion && (
        <div className="liquid-glass p-6 border-red-500/30 bg-red-500/5 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-red-500/20 text-red-400 shadow-glow-red/20">
                <Sparkles size={24} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-red-300 uppercase tracking-widest">
                  AI Recommendation
                </h4>
                <p className="text-lg font-bold text-white mt-1">
                  You should work on:{" "}
                  <span className="text-red-400">
                    {tasks.find((t) => t.id === nextTaskSuggestion.taskId)?.title || "Unknown Task"}
                  </span>
                </p>
                <p className="text-sm text-slate-400 mt-2 max-w-2xl italic">
                  "{nextTaskSuggestion.reasoning}"
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const task = tasks.find((t) => t.id === nextTaskSuggestion.taskId);
                  if (task) onEditTask(task);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-slate-950 rounded-xl text-sm font-bold transition-all shadow-lg shadow-red-500/20"
              >
                Open Task
              </button>
            </div>
          </div>
        </div>
      )}

      <ViewTransition transitionKey={viewMode} type="slide-up" duration={400} className="h-full">
        {viewMode === "calendar" ? (
          <div className="h-[calc(100vh-250px)]">
            <CalendarView
              tasks={tasks}
              priorities={priorities}
              onTaskClick={onEditTask}
              onAddTask={handleAddTask}
              onUpdateDueDate={onUpdateDueDate}
            />
          </div>
        ) : viewMode === "board" ? (
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
                onArchiveTask={onArchiveTask}
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
        ) : viewMode === "gantt" ? (
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
              <StatCard
                label="Active Tasks"
                value={stats.active}
                icon={<LayoutDashboard size={80} />}
                footnote={
                  <span className="flex items-center gap-1">
                    <TrendingUp size={12} /> {Math.floor((stats.active / (stats.total || 1)) * 100)}%
                    of total
                  </span>
                }
              />

              <StatCard
                label="High Priority"
                value={stats.high}
                icon={<AlertCircle size={80} />}
                accent="red"
                footnote="Requires attention"
              />

              <StatCard
                label="Due Soon"
                value={upcomingTasks.length}
                icon={<Clock size={80} />}
                accent="amber"
                footnote="Next 3 days"
              />

              <StatCard
                label="Committed"
                value={stats.completed}
                icon={<CheckCircle2 size={80} />}
                accent="emerald"
                footnote="Merged & done"
              />
            </div>

            {/* Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              {/* Urgent Tasks */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
                    <AlertCircle size={22} />
                  </div>
                  <h2 className="text-2xl font-bold text-white tracking-tight text-glow">
                    Urgent Attention
                  </h2>
                </div>
                <div className="space-y-6">
                  {highPriorityTasks.length === 0 ? (
                    <div className="p-10 border border-dashed border-white/10 rounded-3xl text-center text-slate-300 text-sm bg-white/5 backdrop-blur-sm">
                      No urgent high-priority tasks.
                    </div>
                  ) : (
                    highPriorityTasks.map((task) => (
                      <div
                        key={task.id}
                        className="relative group/card transform transition-all duration-300 hover:scale-[1.01]"
                      >
                        {/* Improved Project Pill */}
                        <div className="absolute -top-3 left-4 z-20 flex items-center gap-2 bg-[#0a0000] border border-white/10 px-3 py-1 rounded-full shadow-lg transition-transform group-hover/card:-translate-y-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
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
                  <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
                    <Clock size={22} />
                  </div>
                  <h2 className="text-2xl font-bold text-white tracking-tight text-glow">
                    Due Soon
                  </h2>
                </div>
                <div className="space-y-6">
                  {upcomingTasks.length === 0 ? (
                    <div className="p-10 border border-dashed border-white/10 rounded-3xl text-center text-slate-300 text-sm bg-white/5 backdrop-blur-sm">
                      No upcoming deadlines in the next 3 days.
                    </div>
                  ) : (
                    upcomingTasks.map((task) => (
                      <div
                        key={task.id}
                        className="relative group/card transform transition-all duration-300 hover:scale-[1.01]"
                      >
                        {/* Improved Project Pill */}
                        <div className="absolute -top-3 left-4 z-20 flex items-center gap-2 bg-[#0a0000] border border-white/10 px-3 py-1 rounded-full shadow-lg transition-transform group-hover/card:-translate-y-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
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
