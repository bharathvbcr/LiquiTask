import { describe, it, expect } from 'vitest';
import { executeAdvancedFilter } from '../queryEngine';
import { Task } from '../../../types';
import { FilterGroup, FilterRule } from '../../types/queryTypes';

describe('QueryEngine', () => {
    const tasks: Task[] = [
        {
            id: '1',
            title: 'Fix login bug',
            status: 'todo',
            priority: 'high',
            tags: ['bug', 'frontend'],
            projectId: 'p1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date(),
            description: '',
            columnId: 'c1',
            assignee: null,
            subtasks: [],
            attachments: [],
            position: 0,
            summary: ''
        } as unknown as Task, // Casting to avoid partial mock issues if Task has more fields
        {
            id: '2',
            title: 'Update documentation',
            status: 'done',
            priority: 'low',
            tags: ['docs'],
            projectId: 'p1',
            createdAt: new Date('2024-01-02'),
            updatedAt: new Date(),
            description: '',
            columnId: 'c1',
            assignee: null,
            subtasks: [],
            attachments: [],
            position: 1,
            summary: ''
        } as unknown as Task
    ];

    it('should filter by title contains', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'title',
                operator: 'contains',
                value: 'login'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });

    it('should filter by priority equals', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'priority',
                operator: 'equals',
                value: 'high'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });

    it('should filter by status equals', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'status',
                operator: 'equals',
                value: 'done'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('2');
    });

    it('should filter by tags contains', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'tags',
                operator: 'contains',
                value: 'bug'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });
});
