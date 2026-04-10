import {
  AlertTriangle,
  BarChart3,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ModalWrapper } from "../../components/ModalWrapper";
import type { AIContext, AIInsight, PriorityDefinition, Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "../services/aiService";
import storageService from "../services/storageService";

interface AIHealthDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  projects: Project[];
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

interface HealthMetric {
  label: string;
  value: string | number;
  trend: "up" | "down" | "stable";
  color: string;
  icon: React.ReactNode;
}

export const AIHealthDashboard: React.FC<AIHealthDashboardProps> = ({
  isOpen,
  onClose,
  allTasks,
  projects,
  addToast,
}) => {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportReport = async (period: "daily" | "weekly") => {
    setIsExporting(true);
    addToast(`Generating ${period} report...`, "info");
    try {
      const { aiSummaryService } = await import("../services/aiSummaryService");
      const report = await (period === "daily"
        ? aiSummaryService.generateDailyReport(allTasks)
        : aiSummaryService.generateWeeklyReport(allTasks));
      aiSummaryService.downloadReport(report);
      addToast(`${period.charAt(0).toUpperCase() + period.slice(1)} report downloaded!`, "success");
    } catch (e) {
      console.error("Report generation failed:", e);
      addToast(`Failed to generate ${period} report`, "error");
    } finally {
      setIsExporting(false);
    }
  };

  const loadHealthData = useCallback(async () => {
    setLoading(true);
    try {
      const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
      const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

      const context: AIContext = {
        activeProjectId,
        projects: projects || [],
        priorities: priorities || [],
      };

      const generatedInsights = await aiService.generateInsights(allTasks, context);
      setInsights(generatedInsights);

      // Calculate health metrics
      const now = new Date();
      const totalTasks = allTasks.length;
      const completedTasks = allTasks.filter(
        (t) => t.completedAt !== undefined && t.completedAt !== null,
      ).length;
      const overdueTasks = allTasks.filter(
        (t) =>
          t.dueDate &&
          new Date(t.dueDate) < now &&
          (t.completedAt === undefined || t.completedAt === null),
      ).length;
      const dueSoonTasks = allTasks.filter((t) => {
        if (!t.dueDate || (t.completedAt !== undefined && t.completedAt !== null)) return false;
        const dueDate = new Date(t.dueDate);
        const diff = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 3;
      }).length;
      const staleTasksCount = allTasks.filter((t) => {
        if (!t.updatedAt) return false;
        const daysSinceUpdate =
          (now.getTime() - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceUpdate > 30 && (t.completedAt === undefined || t.completedAt === null);
      }).length;

      const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      setMetrics([
        {
          label: "Completion Rate",
          value: `${completionRate}%`,
          trend: completionRate >= 50 ? "up" : "down",
          color: completionRate >= 50 ? "text-green-400" : "text-red-400",
          icon: <CheckCircle2 size={20} />,
        },
        {
          label: "Overdue Tasks",
          value: overdueTasks,
          trend: overdueTasks > 0 ? "down" : "stable",
          color: overdueTasks > 0 ? "text-red-400" : "text-green-400",
          icon: <AlertTriangle size={20} />,
        },
        {
          label: "Due in 3 Days",
          value: dueSoonTasks,
          trend: dueSoonTasks > 0 ? "down" : "stable",
          color: dueSoonTasks > 0 ? "text-amber-400" : "text-green-400",
          icon: <Calendar size={20} />,
        },
        {
          label: "Stale Tasks (30+ days)",
          value: staleTasksCount,
          trend: staleTasksCount > 0 ? "down" : "stable",
          color: staleTasksCount > 0 ? "text-orange-400" : "text-green-400",
          icon: <Clock size={20} />,
        },
        {
          label: "Total Tasks",
          value: totalTasks,
          trend: "up",
          color: "text-blue-400",
          icon: <BarChart3 size={20} />,
        },
        {
          label: "Projects",
          value: projects?.length || 0,
          trend: "stable",
          color: "text-purple-400",
          icon: <Sparkles size={20} />,
        },
      ]);
    } catch (error) {
      console.error("Failed to load health data:", error);
      addToast("Failed to load health dashboard", "error");
    } finally {
      setLoading(false);
    }
  }, [allTasks, projects, addToast]);

  useEffect(() => {
    if (isOpen) {
      loadHealthData();
    }
  }, [isOpen, loadHealthData]);

  if (loading) {
    return (
      <ModalWrapper isOpen={isOpen} onClose={onClose} title="Loading AI Health Dashboard">
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-cyan-400 mr-3" />
          <span className="text-slate-400">AI is analyzing your task health...</span>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="AI Health Dashboard" size="xl">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Brain size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white">AI Task Health Overview</h3>
              <p className="text-sm text-slate-400 mt-1">
                Comprehensive analysis of your task management health with AI-generated insights.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportReport("daily")}
              disabled={isExporting}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold transition-all border border-blue-500/20 disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Daily Report
            </button>
            <button
              onClick={() => handleExportReport("weekly")}
              disabled={isExporting}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg text-xs font-bold transition-all border border-purple-500/20 disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Weekly Report
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg bg-white/5 ${metric.color}`}>{metric.icon}</div>
                {metric.trend === "up" ? (
                  <TrendingUp size={16} className="text-green-400" />
                ) : metric.trend === "down" ? (
                  <TrendingDown size={16} className="text-red-400" />
                ) : null}
              </div>
              <div className={`text-2xl font-bold ${metric.color}`}>{metric.value}</div>
              <div className="text-xs text-slate-400 mt-1">{metric.label}</div>
            </div>
          ))}
        </div>

        {/* AI Insights */}
        {insights.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-cyan-400" />
              AI Insights
            </h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {insights.map((insight) => (
                <div
                  key={insight.id}
                  className={`p-4 rounded-xl border ${
                    insight.type === "bottleneck"
                      ? "bg-amber-500/10 border-amber-500/20"
                      : insight.type === "productivity"
                        ? "bg-green-500/10 border-green-500/20"
                        : "bg-blue-500/10 border-blue-500/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-1.5 rounded-lg ${
                        insight.type === "bottleneck"
                          ? "bg-amber-500/20 text-amber-400"
                          : insight.type === "productivity"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-blue-500/20 text-blue-400"
                      }`}
                    >
                      <Brain size={14} />
                    </div>
                    <div className="flex-1">
                      <h5 className="text-sm font-medium text-white">{insight.title}</h5>
                      <p className="text-xs text-slate-300 mt-1">{insight.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {insights.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Brain size={48} className="mx-auto mb-4 opacity-50" />
            <p>No AI insights available. Add more tasks to get health recommendations.</p>
          </div>
        )}
      </div>
    </ModalWrapper>
  );
};
