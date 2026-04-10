import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Brain,
  Calendar,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { BoardColumn, PriorityDefinition, Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { type ProjectRiskSummary, riskAnalysisService } from "../services/riskAnalysisService";
import storageService from "../services/storageService";

interface GanttViewProps {
  tasks: Task[];
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
}

interface GanttTask extends Task {
  startDate: Date;
  endDate: Date;
  dependencies: Task[];
  isOnCriticalPath: boolean;
}

export const GanttView: React.FC<GanttViewProps> = ({ tasks, priorities, onEditTask }) => {
  const [selectedDateRange, setSelectedDateRange] = useState<{
    start: Date;
    end: Date;
  }>(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { start, end };
  });

  const [riskSummary, setRiskSummary] = useState<ProjectRiskSummary | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const analyzeRisks = async () => {
      if (tasks.length < 3) return;
      setIsAnalyzing(true);
      try {
        const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
        const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);

        const summary = await riskAnalysisService.analyzeProjectRisks(tasks, {
          activeProjectId,
          projects,
          priorities,
        });
        setRiskSummary(summary);
      } catch (e) {
        console.error("Risk analysis failed:", e);
      } finally {
        setIsAnalyzing(false);
      }
    };

    analyzeRisks();
  }, [tasks, priorities]);

  // Calculate Gantt data
  const ganttTasks = useMemo(() => {
    return tasks
      .filter((task) => task.dueDate || task.timeEstimate > 0)
      .map((task) => {
        const dueDate = task.dueDate || new Date();
        const estimateDays = Math.ceil((task.timeEstimate || 0) / (8 * 60)); // Convert minutes to days (8h/day)
        const startDate = new Date(dueDate);
        startDate.setDate(startDate.getDate() - estimateDays);

        // Find dependencies
        const dependencies =
          task.links
            ?.filter((link) => link.type === "blocked-by" || link.type === "blocks")
            .map((link) => tasks.find((t) => t.id === link.targetTaskId))
            .filter((t): t is Task => t !== undefined) || [];

        return {
          ...task,
          startDate,
          endDate: dueDate,
          dependencies,
          isOnCriticalPath: riskSummary?.criticalPath.includes(task.id) || false,
        } as GanttTask;
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [tasks, riskSummary]);

  // Calculate date range for display
  const daysInRange = useMemo(() => {
    const days: Date[] = [];
    const current = new Date(selectedDateRange.start);
    while (current <= selectedDateRange.end) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [selectedDateRange]);

  // Calculate task position and width
  const getTaskStyle = (task: GanttTask): React.CSSProperties => {
    const startOffset =
      (task.startDate.getTime() - selectedDateRange.start.getTime()) / (1000 * 60 * 60 * 24);
    const duration = (task.endDate.getTime() - task.startDate.getTime()) / (1000 * 60 * 60 * 24);
    const dayWidth = 40; // pixels per day

    return {
      left: `${startOffset * dayWidth}px`,
      width: `${Math.max(duration * dayWidth, 60)}px`,
    };
  };

  const priorityDef = (priorityId: string) =>
    priorities.find((p) => p.id === priorityId) || {
      color: "#64748b",
      label: "Unknown",
    };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            Predictive Gantt
            {isAnalyzing && <Brain className="text-cyan-400 animate-pulse" size={20} />}
          </h2>
          <p className="text-sm text-slate-400">AI-powered timeline risk & dependency analysis</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="sr-only">Start Date</label>
          <input
            type="date"
            value={selectedDateRange.start.toISOString().split("T")[0]}
            onChange={(e) =>
              setSelectedDateRange((prev) => ({
                ...prev,
                start: new Date(e.target.value),
              }))
            }
            className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 [color-scheme:dark]"
            aria-label="Start date"
            title="Start date"
          />
          <span className="text-slate-400">to</span>
          <label className="sr-only">End Date</label>
          <input
            type="date"
            value={selectedDateRange.end.toISOString().split("T")[0]}
            onChange={(e) =>
              setSelectedDateRange((prev) => ({
                ...prev,
                end: new Date(e.target.value),
              }))
            }
            className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 [color-scheme:dark]"
            aria-label="End date"
            title="End date"
          />
        </div>
      </div>

      {/* AI Risk Dashboard */}
      {riskSummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="col-span-2 bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-4 flex items-center gap-4">
            <div
              className={`p-3 rounded-xl ${riskSummary.overallScore > 0.6 ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}
            >
              {riskSummary.overallScore > 0.6 ? (
                <AlertTriangle size={24} />
              ) : (
                <ShieldCheck size={24} />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">AI Prediction</h3>
              <p className="text-sm text-slate-300">{riskSummary.predictionMessage}</p>
            </div>
          </div>
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Critical Path
              </h3>
              <p className="text-lg font-bold text-white">
                {riskSummary.criticalPath.length} Tasks
              </p>
            </div>
            <div className="h-10 w-1 bg-red-500/50 rounded-full" />
          </div>
        </div>
      )}

      <div className="bg-[#0a0a0a]/50 rounded-2xl border border-white/10 p-4">
        {/* Header with dates */}
        <div className="mb-4 flex border-b border-white/10 pb-2">
          <div className="w-64 shrink-0 font-bold text-xs text-slate-400 uppercase">Task</div>
          <div className="flex-1 flex">
            {daysInRange.map((day) => (
              <div
                key={day.toISOString()}
                className="flex-1 text-center text-xs text-slate-500 border-l border-white/5"
                style={{ minWidth: "40px" }}
              >
                {day.getDate()}
              </div>
            ))}
          </div>
        </div>

        {/* Task rows */}
        <div className="space-y-2">
          {ganttTasks.map((task) => {
            const prio = priorityDef(task.priority);
            const style = getTaskStyle(task);
            const taskRisk = riskSummary?.risks.find((r) => r.taskId === task.id);

            return (
              <div
                key={task.id}
                className={`flex items-center group cursor-pointer hover:bg-white/5 rounded-lg p-2 transition-colors ${task.isOnCriticalPath ? "bg-red-500/5 border-l-2 border-red-500/50" : ""}`}
                onClick={() => onEditTask(task)}
              >
                <div className="w-64 shrink-0 flex items-center gap-2 pr-4">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: prio.color }} />
                  <span
                    className={`text-sm font-medium truncate flex-1 ${task.isOnCriticalPath ? "text-red-200" : "text-slate-200"}`}
                  >
                    {task.title}
                  </span>

                  {/* Risk Indicators */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {taskRisk && (
                      <div title={taskRisk.reason}>
                        <AlertCircle
                          size={14}
                          className={taskRisk.level === "high" ? "text-red-500" : "text-amber-500"}
                        />
                      </div>
                    )}
                    {task.dependencies.length > 0 && (
                      <div title={`Blocked by ${task.dependencies.length} task(s)`}>
                        <Lock size={12} className="text-slate-500" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 relative h-8">
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shadow-lg transition-all group-hover:scale-[1.02] ${task.isOnCriticalPath ? "ring-2 ring-red-500/50 ring-offset-2 ring-offset-black" : ""}`}
                    style={{
                      backgroundColor: prio.color,
                      ...style,
                    }}
                  >
                    {task.jobId}
                  </div>
                  {/* Dependency arrows */}
                  {task.dependencies.map((dep) => {
                    const depTask = ganttTasks.find((t) => t.id === dep.id);
                    if (!depTask) return null;
                    const depStyle = getTaskStyle(depTask);
                    return (
                      <div
                        key={dep.id}
                        className="absolute top-0 left-0 w-0.5 bg-red-400 opacity-50"
                        style={{
                          left: `${parseFloat(String(depStyle.left)) + parseFloat(String(depStyle.width))}px`,
                          width: `${parseFloat(String(style.left)) - parseFloat(String(depStyle.left)) - parseFloat(String(depStyle.width))}px`,
                          height: "2px",
                          top: "50%",
                        }}
                      >
                        <ArrowRight
                          size={8}
                          className="absolute right-0 top-1/2 -translate-y-1/2 text-red-400"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {ganttTasks.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <Calendar size={48} className="mx-auto mb-4 opacity-50" />
            <p>No tasks with due dates or time estimates</p>
            <p className="text-sm mt-2">
              Add due dates or time estimates to see tasks in Gantt view
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GanttView;
