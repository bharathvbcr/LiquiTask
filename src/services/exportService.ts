// Export Service for LiquiTask
// Provides CSV and JSON export functionality for tasks

import { Task, BoardColumn, Project, PriorityDefinition, CustomFieldDefinition } from '../../types';

export interface ExportOptions {
    format: 'csv' | 'json';
    scope: 'all' | 'filtered';
    columns?: string[];
    includeCompleted?: boolean;
}

interface ExportData {
    tasks: Task[];
    projects: Project[];
    columns: BoardColumn[];
    priorities: PriorityDefinition[];
    customFields: CustomFieldDefinition[];
}

// Default columns to include in CSV export
const DEFAULT_CSV_COLUMNS = [
    'id',
    'title',
    'subtitle',
    'status',
    'priority',
    'assignee',
    'projectId',
    'dueDate',
    'createdAt',
    'updatedAt',
    'completedAt',
    'timeEstimate',
    'timeSpent',
    'tags',
];

class ExportService {
    // Generate CSV content from tasks
    exportToCSV(tasks: Task[], columns: string[] = DEFAULT_CSV_COLUMNS, projectMap?: Map<string, string>): string {
        const header = columns.map(col => this.formatColumnHeader(col)).join(',');

        const rows = tasks.map(task => {
            return columns.map(col => {
                const value = this.getTaskValue(task, col, projectMap);
                return this.escapeCSV(value);
            }).join(',');
        });

        return [header, ...rows].join('\n');
    }

    // Format column header for display
    private formatColumnHeader(col: string): string {
        return col
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    // Get value from task for a specific column
    private getTaskValue(task: Task, column: string, projectMap?: Map<string, string>): string {
        switch (column) {
            case 'id':
                return task.id;
            case 'title':
                return task.title;
            case 'subtitle':
                return task.subtitle || '';
            case 'summary':
                return task.summary || '';
            case 'status':
                return task.status;
            case 'priority':
                return task.priority;
            case 'assignee':
                return task.assignee || '';
            case 'projectId':
                return projectMap?.get(task.projectId) || task.projectId;
            case 'dueDate':
                return task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '';
            case 'createdAt':
                return task.createdAt ? new Date(task.createdAt).toISOString() : '';
            case 'updatedAt':
                return task.updatedAt ? new Date(task.updatedAt).toISOString() : '';
            case 'completedAt':
                return task.completedAt ? new Date(task.completedAt).toISOString() : '';
            case 'timeEstimate':
                return task.timeEstimate?.toString() || '0';
            case 'timeSpent':
                return task.timeSpent?.toString() || '0';
            case 'tags':
                return (task.tags || []).join('; ');
            case 'subtasks':
                return (task.subtasks || []).map(st => `${st.completed ? '[x]' : '[ ]'} ${st.title}`).join('; ');
            default:
                // Check custom field values
                if (task.customFieldValues && column in task.customFieldValues) {
                    return String(task.customFieldValues[column]);
                }
                return '';
        }
    }

    // Escape a value for CSV (handle commas, quotes, newlines)
    private escapeCSV(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    // Generate JSON export
    exportToJSON(data: Partial<ExportData>): string {
        return JSON.stringify({
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            ...data,
        }, null, 2);
    }

    // Trigger file download in browser
    downloadFile(content: string, filename: string, mimeType: string): void {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    // Export tasks to CSV and download
    downloadCSV(tasks: Task[], filename: string = 'tasks.csv', projectMap?: Map<string, string>): void {
        const csv = this.exportToCSV(tasks, DEFAULT_CSV_COLUMNS, projectMap);
        this.downloadFile(csv, filename, 'text/csv;charset=utf-8;');
    }

    // Export data to JSON and download
    downloadJSON(data: Partial<ExportData>, filename: string = 'liquitask-export.json'): void {
        const json = this.exportToJSON(data);
        this.downloadFile(json, filename, 'application/json');
    }

    // Get list of available columns for CSV export
    getAvailableColumns(customFields: CustomFieldDefinition[] = []): string[] {
        return [
            ...DEFAULT_CSV_COLUMNS,
            ...customFields.map(cf => cf.id),
        ];
    }
}

// Singleton instance
export const exportService = new ExportService();
export default exportService;
