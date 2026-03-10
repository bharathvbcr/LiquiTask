import { describe, it, expect, beforeEach } from 'vitest';
import { TimeReportingService, TimeReportOptions } from '../timeReportingService';
import { Task, Project } from '../../types';

describe('TimeReportingService', () => {
    let service: TimeReportingService;

    const mockTasks: Task[] = [
        {
            id: '1',
            jobId: 'LT-101',
            title: 'Task 1',
            projectId: 'p1',
            assignee: 'Alice',
            priority: 'high',
            timeSpent: 60,
            timeEstimate: 45,
            createdAt: new Date('2024-01-01'),
            completedAt: new Date('2024-01-02'),
        } as Task,
        {
            id: '2',
            jobId: 'LT-102',
            title: 'Task 2',
            projectId: 'p1',
            assignee: 'Bob',
            priority: 'medium',
            timeSpent: 30,
            timeEstimate: 60,
            createdAt: new Date('2024-01-01'),
        } as Task,
        {
            id: '3',
            jobId: 'LT-103',
            title: 'Task 3',
            projectId: 'p2',
            assignee: 'Alice',
            priority: 'low',
            timeSpent: 120,
            timeEstimate: 120,
            createdAt: new Date('2024-01-05'),
        } as Task
    ];

    const mockProjects: Project[] = [
        { id: 'p1', name: 'Project 1' } as Project,
        { id: 'p2', name: 'Project 2' } as Project
    ];

    beforeEach(() => {
        service = new TimeReportingService();
    });

    it('should generate a comprehensive time report', () => {
        const options: TimeReportOptions = { groupBy: 'project' };
        const report = service.generateTimeReport(mockTasks, options, mockProjects);

        expect(report.totalTimeSpent).toBe(210);
        expect(report.totalTimeEstimate).toBe(225);
        expect(report.tasks).toHaveLength(3);
        
        expect(report.byProject.get('Project 1')?.spent).toBe(90);
        expect(report.byProject.get('Project 2')?.spent).toBe(120);
        
        expect(report.byAssignee.get('Alice')?.spent).toBe(180);
        expect(report.byAssignee.get('Bob')?.spent).toBe(30);
    });

    it('should filter by date range', () => {
        const options: TimeReportOptions = {
            groupBy: 'date',
            dateRange: {
                start: new Date('2024-01-01'),
                end: new Date('2024-01-03')
            }
        };
        const report = service.generateTimeReport(mockTasks, options);
        expect(report.tasks).toHaveLength(2); // Task 1 and 2
    });

    it('should filter by projectIds', () => {
        const options: TimeReportOptions = {
            groupBy: 'project',
            projectIds: ['p1']
        };
        const report = service.generateTimeReport(mockTasks, options);
        expect(report.tasks).toHaveLength(2);
    });

    it('should filter by assignees', () => {
        const options: TimeReportOptions = {
            groupBy: 'assignee',
            assignees: ['Bob']
        };
        const report = service.generateTimeReport(mockTasks, options);
        expect(report.tasks).toHaveLength(1);
        expect(report.tasks[0].task.id).toBe('2');
    });

    it('should calculate productivity metrics', () => {
        const options: TimeReportOptions = { groupBy: 'project' };
        const report = service.generateTimeReport(mockTasks, options);
        const metrics = service.calculateProductivityMetrics(report);

        expect(metrics.averageAccuracy).toBeGreaterThan(0);
        expect(metrics.tasksOverEstimate).toBe(1); // Task 1
        expect(metrics.tasksUnderEstimate).toBe(1); // Task 2
    });

    it('should export time data to CSV', () => {
        const csv = service.exportTimeDataToCSV(mockTasks, mockProjects);
        expect(csv).toContain('Task ID,Title,Project,Assignee');
        expect(csv).toContain('LT-101,Task 1,Project 1,Alice');
    });

    it('should export time data to JSON', () => {
        const options: TimeReportOptions = { groupBy: 'project' };
        const report = service.generateTimeReport(mockTasks, options, mockProjects);
        const json = service.exportTimeDataToJSON(report);
        const parsed = JSON.parse(json);
        
        expect(parsed.totals.timeSpent).toBe(210);
        expect(parsed.byProject).toBeDefined();
    });

    it('should handle tasks with missing data', () => {
        const emptyTasks = [{ id: '4', title: 'Empty', projectId: 'p3', createdAt: new Date() } as Task];
        const report = service.generateTimeReport(emptyTasks, { groupBy: 'project' });
        
        expect(report.totalTimeSpent).toBe(0);
        expect(report.byAssignee.get('Unassigned')).toBeDefined();
    });
});
