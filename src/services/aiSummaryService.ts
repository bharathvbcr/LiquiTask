import type { AIContext, AIInsight, PriorityDefinition, Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "./aiService";
import storageService from "./storageService";

export interface AISummaryReport {
  date: Date;
  period: "daily" | "weekly";
  overview: {
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
    newTasksThisPeriod: number;
    completionRate: number;
  };
  productivity: {
    tasksCompleted: number;
    avgTimePerTask: number;
    estimateAccuracy: number;
    busiestDay: string;
    trend: "up" | "down" | "stable";
  };
  bottlenecks: {
    blockedTasks: number;
    overdueByPriority: Record<string, number>;
    oldestTask: { id: string; title: string; daysOverdue: number } | null;
  };
  recommendations: string[];
  insights: AIInsight[];
}

class AISummaryService {
  private static instance: AISummaryService;

  static getInstance(): AISummaryService {
    if (!AISummaryService.instance) {
      AISummaryService.instance = new AISummaryService();
    }
    return AISummaryService.instance;
  }

  async generateDailyReport(allTasks: Task[]): Promise<AISummaryReport> {
    return this.generateReport(allTasks, "daily");
  }

  async generateWeeklyReport(allTasks: Task[]): Promise<AISummaryReport> {
    return this.generateReport(allTasks, "weekly");
  }

  private async generateReport(
    allTasks: Task[],
    period: "daily" | "weekly",
  ): Promise<AISummaryReport> {
    const now = new Date();
    const periodStart = new Date(now);
    if (period === "daily") {
      periodStart.setDate(periodStart.getDate() - 1);
    } else {
      periodStart.setDate(periodStart.getDate() - 7);
    }

    const completedTasks = allTasks.filter((t) => t.completedAt);
    const overdueTasks = allTasks.filter(
      (t) => t.dueDate && new Date(t.dueDate) < now && !t.completedAt,
    );
    const newTasksThisPeriod = allTasks.filter((t) => new Date(t.createdAt) >= periodStart);
    const completedThisPeriod = completedTasks.filter(
      (t) => t.completedAt && new Date(t.completedAt!) >= periodStart,
    );

    const avgCompletionTime =
      completedThisPeriod.length > 0
        ? completedThisPeriod.reduce((sum, t) => sum + (t.timeSpent || 0), 0) /
          completedThisPeriod.length
        : 0;

    const estimateAccuracy =
      completedThisPeriod.length > 0
        ? completedThisPeriod.reduce((sum, t) => {
            if (t.timeEstimate && t.timeSpent) return sum + t.timeSpent / t.timeEstimate;
            return sum;
          }, 0) / completedThisPeriod.length
        : 1;

    const blockedTasks = allTasks.filter(
      (t) => !t.completedAt && t.links?.some((l) => l.type === "blocked-by"),
    );

    const overdueByPriority: Record<string, number> = {};
    overdueTasks.forEach((t) => {
      const p = t.priority || "unassigned";
      overdueByPriority[p] = (overdueByPriority[p] || 0) + 1;
    });

    const oldestOverdue =
      overdueTasks.length > 0
        ? overdueTasks.reduce((oldest, t) => {
            const days = t.dueDate
              ? (now.getTime() - new Date(t.dueDate).getTime()) / (1000 * 60 * 60 * 24)
              : 0;
            const oldestDays = oldest.dueDate
              ? (now.getTime() - new Date(oldest.dueDate).getTime()) / (1000 * 60 * 60 * 24)
              : 0;
            return days > oldestDays ? t : oldest;
          })
        : null;

    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    const context: AIContext = { activeProjectId, projects, priorities };

    let insights: AIInsight[] = [];
    let recommendations: string[] = [];

    try {
      insights = await aiService.generateInsights(allTasks, context);
      recommendations = insights
        .filter((i) => i.type === "recommendation")
        .map((i) => i.description);
    } catch (e) {
      console.error("AI insights generation failed:", e);
    }

    if (recommendations.length === 0) {
      if (overdueTasks.length > 3)
        recommendations.push(
          `You have ${overdueTasks.length} overdue tasks. Consider reviewing deadlines.`,
        );
      if (blockedTasks.length > 2)
        recommendations.push(
          `${blockedTasks.length} tasks are blocked. Review dependencies to unblock progress.`,
        );
      if (estimateAccuracy > 1.2)
        recommendations.push(
          "Your tasks take ~" +
            Math.round((estimateAccuracy - 1) * 100) +
            "% longer than estimated. Consider increasing time estimates.",
        );
      if (completedThisPeriod.length > 0)
        recommendations.push(
          "Great progress! You completed " + completedThisPeriod.length + " task(s) this period.",
        );
      if (recommendations.length === 0)
        recommendations.push("All tasks are on track. Keep up the good work!");
    }

    const trend: "up" | "down" | "stable" =
      completedThisPeriod.length > 5 ? "up" : completedThisPeriod.length < 2 ? "down" : "stable";

    return {
      date: now,
      period,
      overview: {
        totalTasks: allTasks.length,
        completedTasks: completedTasks.length,
        overdueTasks: overdueTasks.length,
        newTasksThisPeriod: newTasksThisPeriod.length,
        completionRate:
          allTasks.length > 0 ? Math.round((completedTasks.length / allTasks.length) * 100) : 0,
      },
      productivity: {
        tasksCompleted: completedThisPeriod.length,
        avgTimePerTask: Math.round(avgCompletionTime),
        estimateAccuracy: Math.round(estimateAccuracy * 100),
        busiestDay: this.getBusiestDay(completedThisPeriod),
        trend,
      },
      bottlenecks: {
        blockedTasks: blockedTasks.length,
        overdueByPriority,
        oldestTask: oldestOverdue
          ? {
              id: oldestOverdue.id,
              title: oldestOverdue.title,
              daysOverdue: oldestOverdue.dueDate
                ? Math.round(
                    (now.getTime() - new Date(oldestOverdue.dueDate).getTime()) /
                      (1000 * 60 * 60 * 24),
                  )
                : 0,
            }
          : null,
      },
      recommendations,
      insights,
    };
  }

  private getBusiestDay(completedTasks: Task[]): string {
    const dayCounts: Record<string, number> = {};
    completedTasks.forEach((t) => {
      if (t.completedAt) {
        const day = new Date(t.completedAt).toLocaleDateString("en-US", {
          weekday: "long",
        });
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
    });
    let busiest = "N/A";
    let maxCount = 0;
    for (const [day, count] of Object.entries(dayCounts)) {
      if (count > maxCount) {
        maxCount = count;
        busiest = day;
      }
    }
    return busiest;
  }

  exportReportAsMarkdown(report: AISummaryReport): string {
    return `# LiquiTask ${report.period === "daily" ? "Daily" : "Weekly"} AI Summary
Generated: ${report.date.toLocaleString()}

## Overview
- **Total Tasks:** ${report.overview.totalTasks}
- **Completed:** ${report.overview.completedTasks}
- **Overdue:** ${report.overview.overdueTasks}
- **New This Period:** ${report.overview.newTasksThisPeriod}
- **Completion Rate:** ${report.overview.completionRate}%

## Productivity
- **Tasks Completed This Period:** ${report.productivity.tasksCompleted}
- **Avg Time Per Task:** ${report.productivity.avgTimePerTask} min
- **Estimate Accuracy:** ${report.productivity.estimateAccuracy}%
- **Busiest Day:** ${report.productivity.busiestDay}
- **Trend:** ${report.productivity.trend === "up" ? "📈 Improving" : report.productivity.trend === "down" ? "📉 Declining" : "➡️ Stable"}

## Bottlenecks
- **Blocked Tasks:** ${report.bottlenecks.blockedTasks}
- **Overdue by Priority:** ${Object.entries(report.bottlenecks.overdueByPriority)
      .map(([p, c]) => `${p}: ${c}`)
      .join(", ")}
${report.bottlenecks.oldestTask ? `- **Oldest Overdue:** "${report.bottlenecks.oldestTask.title}" (${report.bottlenecks.oldestTask.daysOverdue} days)` : ""}

## Recommendations
${report.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}

## AI Insights
${report.insights.map((i) => `- **${i.title}**: ${i.description}`).join("\n")}
`;
  }

  downloadReport(report: AISummaryReport): void {
    const markdown = this.exportReportAsMarkdown(report);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liquitask-${report.period}-summary-${report.date.toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const aiSummaryService = AISummaryService.getInstance();
export default aiSummaryService;
