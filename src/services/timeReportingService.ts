import type { Project, Task } from "../../types";
import { dateToMs, toCoreTask } from "../runtime/coreDto";
import { callNative } from "../runtime/runtimeEnvironment";

export interface TimeReport {
  totalTimeSpent: number;
  totalTimeEstimate: number;
  tasks: Array<{
    task: Task;
    timeSpent: number;
    timeEstimate: number;
    variance: number; // actual - estimate
  }>;
  byProject: Map<string, { spent: number; estimate: number; count: number }>;
  byAssignee: Map<string, { spent: number; estimate: number; count: number }>;
  byDate: Map<string, { spent: number; estimate: number; count: number }>;
  byPriority: Map<string, { spent: number; estimate: number; count: number }>;
}

export interface TimeReportOptions {
  groupBy: "project" | "assignee" | "date" | "priority";
  dateRange?: { start: Date; end: Date };
  projectIds?: string[];
  assignees?: string[];
}

export class TimeReportingService {
  /**
   * Generate time report
   */
  generateTimeReport(tasks: Task[], options: TimeReportOptions, projects?: Project[]): TimeReport {
    // Filter by date range if provided
    let filteredTasks = tasks;
    if (options.dateRange) {
      const { start, end } = options.dateRange;
      filteredTasks = tasks.filter((task) => {
        const taskDate = task.completedAt || task.createdAt;
        return taskDate >= start && taskDate <= end;
      });
    }

    // Filter by project if provided
    if (options.projectIds && options.projectIds.length > 0) {
      const { projectIds } = options;
      filteredTasks = filteredTasks.filter((t) => projectIds.includes(t.projectId));
    }

    // Filter by assignee if provided
    if (options.assignees && options.assignees.length > 0) {
      const { assignees } = options;
      filteredTasks = filteredTasks.filter((t) => assignees.includes(t.assignee));
    }

    // Calculate totals
    const totalTimeSpent = filteredTasks.reduce((sum, t) => sum + (t.timeSpent || 0), 0);
    const totalTimeEstimate = filteredTasks.reduce((sum, t) => sum + (t.timeEstimate || 0), 0);

    // Group by specified dimension
    const byProject = new Map<string, { spent: number; estimate: number; count: number }>();
    const byAssignee = new Map<string, { spent: number; estimate: number; count: number }>();
    const byDate = new Map<string, { spent: number; estimate: number; count: number }>();
    const byPriority = new Map<string, { spent: number; estimate: number; count: number }>();

    filteredTasks.forEach((task) => {
      // Group by project
      const projectName = projects?.find((p) => p.id === task.projectId)?.name || task.projectId;
      const projectData = byProject.get(projectName) || {
        spent: 0,
        estimate: 0,
        count: 0,
      };
      projectData.spent += task.timeSpent || 0;
      projectData.estimate += task.timeEstimate || 0;
      projectData.count += 1;
      byProject.set(projectName, projectData);

      // Group by assignee
      const assignee = task.assignee || "Unassigned";
      const assigneeData = byAssignee.get(assignee) || {
        spent: 0,
        estimate: 0,
        count: 0,
      };
      assigneeData.spent += task.timeSpent || 0;
      assigneeData.estimate += task.timeEstimate || 0;
      assigneeData.count += 1;
      byAssignee.set(assignee, assigneeData);

      // Group by date
      const dateKey = (task.completedAt || task.createdAt).toISOString().split("T")[0];
      const dateData = byDate.get(dateKey) || {
        spent: 0,
        estimate: 0,
        count: 0,
      };
      dateData.spent += task.timeSpent || 0;
      dateData.estimate += task.timeEstimate || 0;
      dateData.count += 1;
      byDate.set(dateKey, dateData);

      // Group by priority
      const priorityData = byPriority.get(task.priority) || {
        spent: 0,
        estimate: 0,
        count: 0,
      };
      priorityData.spent += task.timeSpent || 0;
      priorityData.estimate += task.timeEstimate || 0;
      priorityData.count += 1;
      byPriority.set(task.priority, priorityData);
    });

    // Calculate task-level data
    const taskData = filteredTasks.map((task) => ({
      task,
      timeSpent: task.timeSpent || 0,
      timeEstimate: task.timeEstimate || 0,
      variance: (task.timeSpent || 0) - (task.timeEstimate || 0),
    }));

    return {
      totalTimeSpent,
      totalTimeEstimate,
      tasks: taskData,
      byProject,
      byAssignee,
      byDate,
      byPriority,
    };
  }

  /**
   * Export time data to CSV
   */
  exportTimeDataToCSV(tasks: Task[], projects?: Project[]): string {
    const header =
      "Task ID,Title,Project,Assignee,Time Estimate (min),Time Spent (min),Variance (min),Estimate Accuracy (%)";
    const rows = tasks.map((task) => {
      const projectName = projects?.find((p) => p.id === task.projectId)?.name || task.projectId;
      const estimate = task.timeEstimate || 0;
      const spent = task.timeSpent || 0;
      const variance = spent - estimate;
      const accuracy = estimate > 0 ? Math.round((1 - Math.abs(variance) / estimate) * 100) : 0;

      return [
        task.jobId,
        this.escapeCSV(task.title),
        this.escapeCSV(projectName),
        this.escapeCSV(task.assignee || "Unassigned"),
        estimate,
        spent,
        variance,
        accuracy,
      ].join(",");
    });

    return [header, ...rows].join("\n");
  }

  /**
   * Export time data to JSON
   */
  exportTimeDataToJSON(report: TimeReport): string {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totals: {
          timeSpent: report.totalTimeSpent,
          timeEstimate: report.totalTimeEstimate,
          variance: report.totalTimeSpent - report.totalTimeEstimate,
        },
        byProject: Object.fromEntries(report.byProject),
        byAssignee: Object.fromEntries(report.byAssignee),
        byDate: Object.fromEntries(report.byDate),
        byPriority: Object.fromEntries(report.byPriority),
        tasks: report.tasks.map((t) => ({
          taskId: t.task.id,
          jobId: t.task.jobId,
          title: t.task.title,
          timeSpent: t.timeSpent,
          timeEstimate: t.timeEstimate,
          variance: t.variance,
        })),
      },
      null,
      2,
    );
  }

  /**
   * Escape CSV value
   */
  private escapeCSV(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Get productivity metrics
   */
  calculateProductivityMetrics(report: TimeReport): {
    averageAccuracy: number;
    tasksOverEstimate: number;
    tasksUnderEstimate: number;
    averageVariance: number;
  } {
    const tasksWithEstimates = report.tasks.filter((t) => t.timeEstimate > 0);

    if (tasksWithEstimates.length === 0) {
      return {
        averageAccuracy: 0,
        tasksOverEstimate: 0,
        tasksUnderEstimate: 0,
        averageVariance: 0,
      };
    }

    const accuracies = tasksWithEstimates.map((t) => {
      const variance = Math.abs(t.variance);
      return Math.max(0, Math.round((1 - variance / t.timeEstimate) * 100));
    });

    const averageAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
    const tasksOverEstimate = tasksWithEstimates.filter((t) => t.variance > 0).length;
    const tasksUnderEstimate = tasksWithEstimates.filter((t) => t.variance < 0).length;
    const averageVariance =
      tasksWithEstimates.reduce((sum, t) => sum + t.variance, 0) / tasksWithEstimates.length;

    return {
      averageAccuracy: Math.round(averageAccuracy),
      tasksOverEstimate,
      tasksUnderEstimate,
      averageVariance: Math.round(averageVariance),
    };
  }

  // ---------------------------------------------------------------------------
  // Native (Rust `liquitask-core`) bridge. The four methods below mirror the
  // synchronous JS ones above but delegate the pure aggregation/serialization to
  // the `liquitask-core` crate through Tauri commands. On the web/PWA build (no
  // Tauri backend) — and if a native call throws — `callNative` transparently
  // runs the identical JS implementation, proven equivalent by the differential
  // oracle (scripts/rust-migration-oracle/services/time_reporting.cjs).
  //
  // The core groups `byProject` by project *name* and does not model `Project`,
  // so we pass an `id -> name` map built from the renderer's projects. Dates
  // cross as epoch millis (see coreDto). The core is clock-free, so `nowMs` is
  // passed in for the JSON `generatedAt`.
  // ---------------------------------------------------------------------------

  /** Build the `projectId -> name` map the Rust core groups on. */
  private buildProjectNames(projects?: Project[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const p of projects ?? []) {
      map[p.id] = p.name;
    }
    return map;
  }

  /** Rebuild a `Map<string, Bucket>` from the plain object the Rust core returns. */
  private toBucketMap(
    obj: Record<string, { spent: number; estimate: number; count: number }>,
  ): Map<string, { spent: number; estimate: number; count: number }> {
    return new Map(Object.entries(obj ?? {}));
  }

  /**
   * Rust-backed {@link generateTimeReport}. Reconstructs the SAME `TimeReport`
   * shape as the sync method (Map fields rebuilt via `new Map(Object.entries)`;
   * each task row re-linked to its full `Task` by id).
   */
  async generateTimeReportNative(
    tasks: Task[],
    options: TimeReportOptions,
    projects?: Project[],
  ): Promise<TimeReport> {
    const nativeReport = await callNative<{
      totalTimeSpent: number;
      totalTimeEstimate: number;
      tasks: Array<{
        taskId: string;
        jobId: string;
        title: string;
        timeSpent: number;
        timeEstimate: number;
        variance: number;
      }>;
      byProject: Record<string, { spent: number; estimate: number; count: number }>;
      byAssignee: Record<string, { spent: number; estimate: number; count: number }>;
      byDate: Record<string, { spent: number; estimate: number; count: number }>;
      byPriority: Record<string, { spent: number; estimate: number; count: number }>;
    } | null>(
      "time_generate_report",
      {
        tasks: tasks.map(toCoreTask),
        options: {
          groupBy: options.groupBy,
          dateRange: options.dateRange
            ? { start: dateToMs(options.dateRange.start), end: dateToMs(options.dateRange.end) }
            : undefined,
          projectIds: options.projectIds,
          assignees: options.assignees,
        },
        projectNames: this.buildProjectNames(projects),
      },
      () => null,
    );

    // Web fallback (or native failure): run the identical JS implementation and
    // return its already-correct `TimeReport`.
    if (!nativeReport) {
      return this.generateTimeReport(tasks, options, projects);
    }

    // Reconstruct the TS `TimeReport`: re-link each flattened row to its Task.
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return {
      totalTimeSpent: nativeReport.totalTimeSpent,
      totalTimeEstimate: nativeReport.totalTimeEstimate,
      tasks: nativeReport.tasks.map((row) => ({
        task: byId.get(row.taskId) as Task,
        timeSpent: row.timeSpent,
        timeEstimate: row.timeEstimate,
        variance: row.variance,
      })),
      byProject: this.toBucketMap(nativeReport.byProject),
      byAssignee: this.toBucketMap(nativeReport.byAssignee),
      byDate: this.toBucketMap(nativeReport.byDate),
      byPriority: this.toBucketMap(nativeReport.byPriority),
    };
  }

  /**
   * Rust-backed {@link calculateProductivityMetrics}. Sends the flattened task
   * rows (all the metrics need) so the crate can compute over them.
   */
  async calculateProductivityMetricsNative(report: TimeReport): Promise<{
    averageAccuracy: number;
    tasksOverEstimate: number;
    tasksUnderEstimate: number;
    averageVariance: number;
  }> {
    return callNative(
      "time_productivity_metrics",
      { report: this.toNativeReport(report) },
      () => this.calculateProductivityMetrics(report),
    );
  }

  /** Rust-backed {@link exportTimeDataToCSV}; identical string on both paths. */
  async exportTimeDataToCSVNative(tasks: Task[], projects?: Project[]): Promise<string> {
    return callNative(
      "time_export_csv",
      { tasks: tasks.map(toCoreTask), projectNames: this.buildProjectNames(projects) },
      () => this.exportTimeDataToCSV(tasks, projects),
    );
  }

  /** Rust-backed {@link exportTimeDataToJSON}; `generatedAt` derives from `nowMs`. */
  async exportTimeDataToJSONNative(
    report: TimeReport,
    now: Date = new Date(),
  ): Promise<string> {
    return callNative(
      "time_export_json",
      { report: this.toNativeReport(report), nowMs: now.getTime() },
      () => this.exportTimeDataToJSON(report),
    );
  }

  /**
   * Flatten a `TimeReport` back into the plain DTO the Rust core expects
   * (`Map`s -> objects, task rows -> `{ taskId, jobId, title, ... }`). Used by
   * the metrics/JSON commands which take an already-computed report.
   */
  private toNativeReport(report: TimeReport) {
    return {
      totalTimeSpent: report.totalTimeSpent,
      totalTimeEstimate: report.totalTimeEstimate,
      tasks: report.tasks.map((t) => ({
        taskId: t.task.id,
        jobId: t.task.jobId,
        title: t.task.title,
        timeSpent: t.timeSpent,
        timeEstimate: t.timeEstimate,
        variance: t.variance,
      })),
      byProject: Object.fromEntries(report.byProject),
      byAssignee: Object.fromEntries(report.byAssignee),
      byDate: Object.fromEntries(report.byDate),
      byPriority: Object.fromEntries(report.byPriority),
    };
  }
}

// Singleton instance
export const timeReportingService = new TimeReportingService();
