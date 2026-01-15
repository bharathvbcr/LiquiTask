// Export Service for LiquiTask
// Provides CSV, JSON, Markdown, and iCal export functionality for tasks

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

    // Export to Markdown
    exportToMarkdown(tasks: Task[], template?: string): string {
        const defaultTemplate = `# Task Export

Generated: {{date}}

## Tasks

{{#tasks}}
### {{title}}
- **ID:** {{jobId}}
- **Status:** {{status}}
- **Priority:** {{priority}}
- **Assignee:** {{assignee}}
- **Due Date:** {{dueDate}}
- **Description:** {{summary}}

{{/tasks}}
`;

        const tpl = template || defaultTemplate;
        const date = new Date().toLocaleDateString();
        let output = tpl.replace('{{date}}', date);

        const tasksMarkdown = tasks.map(task => {
            let taskMd = tpl.includes('{{#tasks}}') 
                ? tpl.split('{{#tasks}}')[1].split('{{/tasks}}')[0]
                : defaultTemplate.split('{{#tasks}}')[1].split('{{/tasks}}')[0];

            taskMd = taskMd
                .replace(/\{\{title\}\}/g, task.title)
                .replace(/\{\{jobId\}\}/g, task.jobId)
                .replace(/\{\{status\}\}/g, task.status)
                .replace(/\{\{priority\}\}/g, task.priority)
                .replace(/\{\{assignee\}\}/g, task.assignee || 'Unassigned')
                .replace(/\{\{dueDate\}\}/g, task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No date')
                .replace(/\{\{summary\}\}/g, task.summary || '');

            return taskMd;
        }).join('\n\n');

        output = output.replace(/{{#tasks}}[\s\S]*?{{\/tasks}}/, tasksMarkdown);
        return output;
    }

    // Export to iCal (ICS format)
    exportToICS(tasks: Task[], filename: string = 'liquitask-calendar.ics'): void {
        const icsLines: string[] = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//LiquiTask//Task Management//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
        ];

        tasks.forEach(task => {
            if (!task.dueDate) return;

            const dueDate = new Date(task.dueDate);
            const dueDateStr = dueDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

            icsLines.push('BEGIN:VTODO');
            icsLines.push(`UID:${task.id}@liquitask`);
            icsLines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
            icsLines.push(`DUE:${dueDateStr}`);
            icsLines.push(`SUMMARY:${this.escapeICS(task.title)}`);
            if (task.summary) {
                icsLines.push(`DESCRIPTION:${this.escapeICS(task.summary)}`);
            }
            icsLines.push(`STATUS:${task.status === 'Completed' ? 'COMPLETED' : 'NEEDS-ACTION'}`);
            icsLines.push('END:VTODO');
        });

        icsLines.push('END:VCALENDAR');

        const icsContent = icsLines.join('\r\n');
        this.downloadFile(icsContent, filename, 'text/calendar;charset=utf-8');
    }

    // Escape text for ICS format
    private escapeICS(text: string): string {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

}

// Singleton instance
export const exportService = new ExportService();
export default exportService;
