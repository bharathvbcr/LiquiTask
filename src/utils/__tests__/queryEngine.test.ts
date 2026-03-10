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

    it('should support not-equals operator', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'priority',
                operator: 'not-equals',
                value: 'high'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('2');
    });

    it('should support starts-with and ends-with', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'OR',
            rules: [
                { id: 'r1', field: 'title', operator: 'starts-with', value: 'Fix' } as FilterRule,
                { id: 'r2', field: 'title', operator: 'ends-with', value: 'documentation' } as FilterRule
            ]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(2);
    });

    it('should support date comparisons (before/after)', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'createdAt',
                operator: 'before',
                value: '2024-01-02'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });

    it('should support is-empty and is-not-empty', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'assignee',
                operator: 'is-empty',
                value: ''
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(2); // Both tasks have null assignee
    });

    it('should support nested groups with AND/OR logic', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [
                { id: 'r1', field: 'projectId', operator: 'equals', value: 'p1' } as FilterRule,
                {
                    id: 'sub1',
                    operator: 'OR',
                    rules: [
                        { id: 'r2', field: 'priority', operator: 'equals', value: 'high' } as FilterRule,
                        { id: 'r3', field: 'status', operator: 'equals', value: 'done' } as FilterRule
                    ]
                } as unknown as FilterGroup
            ]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(2);
    });

    it('should support regex matching', () => {
        const filter: FilterGroup = {
            id: 'root',
            operator: 'AND',
            rules: [{
                id: 'rule1',
                field: 'title',
                operator: 'matches-regex',
                value: 'l.g.n'
            } as FilterRule]
        };
        const result = executeAdvancedFilter(tasks, filter);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });
});
