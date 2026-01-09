import { describe, it, expect } from 'vitest';
import { validateBulkTasks, BULK_TASK_TEMPLATE_JSON, generateTemplateBlob } from '../bulkTaskSchema';

describe('bulkTaskSchema', () => {
    describe('validateBulkTasks', () => {
        it('should validate a correct JSON input', () => {
            const input = JSON.stringify({
                tasks: [
                    { title: 'Task 1', priority: 'high' },
                    { title: 'Task 2', assignee: 'John' },
                ],
            });

            const result = validateBulkTasks(input);

            expect(result.valid).toBe(true);
            expect(result.tasks).toHaveLength(2);
            expect(result.tasks?.[0].title).toBe('Task 1');
            expect(result.tasks?.[0].priority).toBe('high');
            expect(result.tasks?.[1].assignee).toBe('John');
        });

        it('should reject invalid JSON syntax', () => {
            const result = validateBulkTasks('{ invalid json }');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid JSON');
        });

        it('should reject missing tasks array', () => {
            const result = validateBulkTasks(JSON.stringify({ items: [] }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Missing "tasks" array');
        });

        it('should reject empty tasks array', () => {
            const result = validateBulkTasks(JSON.stringify({ tasks: [] }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('empty');
        });

        it('should reject task without title', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ priority: 'high' }],
            }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('title');
        });

        it('should handle optional fields correctly', () => {
            const input = JSON.stringify({
                tasks: [{
                    title: 'Full Task',
                    subtitle: 'A subtitle',
                    summary: 'Description here',
                    priority: 'medium',
                    assignee: 'Jane',
                    dueDate: '2024-12-31',
                    tags: ['tag1', 'tag2'],
                    timeEstimate: 60,
                    subtasks: [
                        { title: 'Subtask 1', completed: false },
                        { title: 'Subtask 2', completed: true },
                    ],
                }],
            });

            const result = validateBulkTasks(input);

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].subtitle).toBe('A subtitle');
            expect(result.tasks?.[0].tags).toEqual(['tag1', 'tag2']);
            expect(result.tasks?.[0].subtasks).toHaveLength(2);
            expect(result.tasks?.[0].subtasks?.[1].completed).toBe(true);
        });

        it('should parse dates correctly', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', dueDate: '2024-06-15' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].dueDate).toBeInstanceOf(Date);
        });

        it('should reject invalid date format', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', dueDate: 'not-a-date' }],
            }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('date');
        });

        it('should reject too many tasks', () => {
            const tasks = Array.from({ length: 101 }, (_, i) => ({ title: `Task ${i}` }));
            const result = validateBulkTasks(JSON.stringify({ tasks }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Too many tasks');
        });

        it('should warn about unknown priorities', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', priority: 'critical' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.warnings).toBeDefined();
            expect(result.warnings?.[0]).toContain('Unknown priority');
        });
    });

    describe('BULK_TASK_TEMPLATE_JSON', () => {
        it('should be valid JSON', () => {
            expect(() => JSON.parse(BULK_TASK_TEMPLATE_JSON)).not.toThrow();
        });

        it('should validate successfully', () => {
            const result = validateBulkTasks(BULK_TASK_TEMPLATE_JSON);
            expect(result.valid).toBe(true);
        });
    });

    describe('generateTemplateBlob', () => {
        it('should generate a Blob', () => {
            const blob = generateTemplateBlob();
            expect(blob).toBeInstanceOf(Blob);
            expect(blob.type).toBe('application/json');
        });
    });
});
