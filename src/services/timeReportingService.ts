import { Task, Project } from '../../types';

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
    groupBy: 'project' | 'assignee' | 'date' | 'priority';
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
            filteredTasks = tasks.filter(task => {
                const taskDate = task.completedAt || task.createdAt;
                return taskDate >= options.dateRange!.start && taskDate <= options.dateRange!.end;
            });
        }

        // Filter by project if provided
        if (options.projectIds && options.projectIds.length > 0) {
            filteredTasks = filteredTasks.filter(t => options.projectIds!.includes(t.projectId));
        }

        // Filter by assignee if provided
        if (options.assignees && options.assignees.length > 0) {
            filteredTasks = filteredTasks.filter(t => options.assignees!.includes(t.assignee));
        }

        // Calculate totals
        const totalTimeSpent = filteredTasks.reduce((sum, t) => sum + (t.timeSpent || 0), 0);
        const totalTimeEstimate = filteredTasks.reduce((sum, t) => sum + (t.timeEstimate || 0), 0);

        // Group by specified dimension
        const byProject = new Map<string, { spent: number; estimate: number; count: number }>();
        const byAssignee = new Map<string, { spent: number; estimate: number; count: number }>();
        const byDate = new Map<string, { spent: number; estimate: number; count: number }>();
        const byPriority = new Map<string, { spent: number; estimate: number; count: number }>();

        filteredTasks.forEach(task => {
            // Group by project
            const projectName = projects?.find(p => p.id === task.projectId)?.name || task.projectId;
            const projectData = byProject.get(projectName) || { spent: 0, estimate: 0, count: 0 };
            projectData.spent += task.timeSpent || 0;
            projectData.estimate += task.timeEstimate || 0;
            projectData.count += 1;
            byProject.set(projectName, projectData);

            // Group by assignee
            const assignee = task.assignee || 'Unassigned';
            const assigneeData = byAssignee.get(assignee) || { spent: 0, estimate: 0, count: 0 };
            assigneeData.spent += task.timeSpent || 0;
            assigneeData.estimate += task.timeEstimate || 0;
            assigneeData.count += 1;
            byAssignee.set(assignee, assigneeData);

            // Group by date
            const dateKey = (task.completedAt || task.createdAt).toISOString().split('T')[0];
            const dateData = byDate.get(dateKey) || { spent: 0, estimate: 0, count: 0 };
            dateData.spent += task.timeSpent || 0;
            dateData.estimate += task.timeEstimate || 0;
            dateData.count += 1;
            byDate.set(dateKey, dateData);

            // Group by priority
            const priorityData = byPriority.get(task.priority) || { spent: 0, estimate: 0, count: 0 };
            priorityData.spent += task.timeSpent || 0;
            priorityData.estimate += task.timeEstimate || 0;
            priorityData.count += 1;
            byPriority.set(task.priority, priorityData);
        });

        // Calculate task-level data
        const taskData = filteredTasks.map(task => ({
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
        const header = 'Task ID,Title,Project,Assignee,Time Estimate (min),Time Spent (min),Variance (min),Estimate Accuracy (%)';
        const rows = tasks.map(task => {
            const projectName = projects?.find(p => p.id === task.projectId)?.name || task.projectId;
            const estimate = task.timeEstimate || 0;
            const spent = task.timeSpent || 0;
            const variance = spent - estimate;
            const accuracy = estimate > 0 ? Math.round((1 - Math.abs(variance) / estimate) * 100) : 0;

            return [
                task.jobId,
                this.escapeCSV(task.title),
                this.escapeCSV(projectName),
                this.escapeCSV(task.assignee || 'Unassigned'),
                estimate,
                spent,
                variance,
                accuracy,
            ].join(',');
        });

        return [header, ...rows].join('\n');
    }

    /**
     * Export time data to JSON
     */
    exportTimeDataToJSON(report: TimeReport): string {
        return JSON.stringify({
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
            tasks: report.tasks.map(t => ({
                taskId: t.task.id,
                jobId: t.task.jobId,
                title: t.task.title,
                timeSpent: t.timeSpent,
                timeEstimate: t.timeEstimate,
                variance: t.variance,
            })),
        }, null, 2);
    }

    /**
     * Escape CSV value
     */
    private escapeCSV(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
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
        const tasksWithEstimates = report.tasks.filter(t => t.timeEstimate > 0);
        
        if (tasksWithEstimates.length === 0) {
            return {
                averageAccuracy: 0,
                tasksOverEstimate: 0,
                tasksUnderEstimate: 0,
                averageVariance: 0,
            };
        }

        const accuracies = tasksWithEstimates.map(t => {
            const variance = Math.abs(t.variance);
            return Math.max(0, Math.round((1 - variance / t.timeEstimate) * 100));
        });

        const averageAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
        const tasksOverEstimate = tasksWithEstimates.filter(t => t.variance > 0).length;
        const tasksUnderEstimate = tasksWithEstimates.filter(t => t.variance < 0).length;
        const averageVariance = tasksWithEstimates.reduce((sum, t) => sum + t.variance, 0) / tasksWithEstimates.length;

        return {
            averageAccuracy: Math.round(averageAccuracy),
            tasksOverEstimate,
            tasksUnderEstimate,
            averageVariance: Math.round(averageVariance),
        };
    }
}

// Singleton instance
export const timeReportingService = new TimeReportingService();
