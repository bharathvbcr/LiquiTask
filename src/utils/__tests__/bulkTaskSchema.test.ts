import { describe, it, expect } from 'vitest';
import { validateBulkTasks, BULK_TASK_TEMPLATE_JSON, generateTemplateBlob } from '../bulkTaskSchema';

describe('bulkTaskSchema', () => {
    describe('validateBulkTasks', () => {
        // ============ BASIC VALIDATION ============

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

        it('should reject too many tasks', () => {
            const tasks = Array.from({ length: 101 }, (_, i) => ({ title: `Task ${i}` }));
            const result = validateBulkTasks(JSON.stringify({ tasks }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Too many tasks');
        });

        // ============ MINIMAL TASK (EDGE CASE - BUG SCENARIO) ============

        it('should accept task with only title (minimal task)', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Minimal Task' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks).toHaveLength(1);
            expect(result.tasks?.[0].title).toBe('Minimal Task');
            // Should default optional fields
            expect(result.tasks?.[0].priority).toBe('medium');
            expect(result.tasks?.[0].subtitle).toBe('');
            expect(result.tasks?.[0].summary).toBe('');
            expect(result.tasks?.[0].assignee).toBe('');
            expect(result.tasks?.[0].tags).toEqual([]);
            expect(result.tasks?.[0].timeEstimate).toBe(0);
            expect(result.tasks?.[0].subtasks).toEqual([]);
        });

        it('should handle task with undefined subtasks', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'No Subtasks', subtasks: undefined }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].subtasks).toEqual([]);
        });

        it('should handle task with empty subtasks array', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Empty Subtasks', subtasks: [] }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].subtasks).toEqual([]);
        });

        // ============ OPTIONAL FIELDS ============

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

        it('should handle empty tags array', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', tags: [] }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].tags).toEqual([]);
        });

        it('should filter non-string tags', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', tags: ['valid', 123, null, 'also-valid'] }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].tags).toEqual(['valid', 'also-valid']);
        });

        // ============ DATE HANDLING ============

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

        it('should handle ISO date strings', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', dueDate: '2024-12-31T23:59:59.000Z' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].dueDate).toBeInstanceOf(Date);
        });

        // ============ PRIORITY HANDLING ============

        it('should warn about unknown priorities', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', priority: 'critical' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.warnings).toBeDefined();
            expect(result.warnings?.[0]).toContain('Unknown priority');
        });

        it('should accept all standard priorities', () => {
            const priorities = ['high', 'medium', 'low'];

            for (const priority of priorities) {
                const result = validateBulkTasks(JSON.stringify({
                    tasks: [{ title: 'Task', priority }],
                }));
                expect(result.valid).toBe(true);
                expect(result.warnings).toBeUndefined();
            }
        });

        it('should handle case-insensitive priorities', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', priority: 'HIGH' }],
            }));

            expect(result.valid).toBe(true);
            // Should not warn for valid priority in different case
        });

        // ============ SUBTASKS ============

        it('should generate unique subtask IDs', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{
                    title: 'Task',
                    subtasks: [
                        { title: 'Sub 1' },
                        { title: 'Sub 2' },
                    ],
                }],
            }));

            expect(result.valid).toBe(true);
            const ids = result.tasks?.[0].subtasks?.map(s => s.id);
            expect(new Set(ids).size).toBe(ids?.length); // All unique
        });

        it('should default subtask completed to false', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{
                    title: 'Task',
                    subtasks: [{ title: 'Subtask without completed field' }],
                }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].subtasks?.[0].completed).toBe(false);
        });

        it('should reject subtask without title', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{
                    title: 'Task',
                    subtasks: [{ completed: true }],
                }],
            }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Subtask');
            expect(result.error).toContain('title');
        });

        it('should reject non-object subtask', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{
                    title: 'Task',
                    subtasks: ['just a string'],
                }],
            }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Subtask');
        });

        // ============ TIME ESTIMATE ============

        it('should reject negative time estimate', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', timeEstimate: -10 }],
            }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('timeEstimate');
        });

        it('should accept zero time estimate', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', timeEstimate: 0 }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].timeEstimate).toBe(0);
        });

        it('should accept large time estimate', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task', timeEstimate: 9999 }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].timeEstimate).toBe(9999);
        });

        // ============ SPECIAL CHARACTERS & EDGE CASES ============

        it('should handle special characters in title', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: 'Task with émojis 🚀 and "quotes"' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].title).toBe('Task with émojis 🚀 and "quotes"');
        });

        it('should trim whitespace from title', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: '  Padded Title  ' }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].title).toBe('Padded Title');
        });

        it('should reject whitespace-only title', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: '   ' }],
            }));

            expect(result.valid).toBe(false);
            expect(result.error).toContain('title');
        });

        it('should handle very long title', () => {
            const longTitle = 'A'.repeat(1000);
            const result = validateBulkTasks(JSON.stringify({
                tasks: [{ title: longTitle }],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks?.[0].title).toBe(longTitle);
        });

        // ============ REAL WORLD SCENARIO ============

        it('should handle large real-world payload', () => {
            const tasks = Array.from({ length: 50 }, (_, i) => ({
                title: `Task ${i + 1}`,
                subtitle: `Category ${Math.floor(i / 10)}`,
                summary: `This is task number ${i + 1} with a description.`,
                priority: ['high', 'medium', 'low'][i % 3],
                tags: [`tag-${i % 5}`, 'common'],
                subtasks: i % 3 === 0 ? [
                    { title: `Subtask A`, completed: false },
                    { title: `Subtask B`, completed: true },
                ] : undefined,
            }));

            const result = validateBulkTasks(JSON.stringify({ tasks }));

            expect(result.valid).toBe(true);
            expect(result.tasks).toHaveLength(50);
        });

        it('should handle mixed valid and minimal tasks', () => {
            const result = validateBulkTasks(JSON.stringify({
                tasks: [
                    { title: 'Minimal' },
                    { title: 'Full', priority: 'high', tags: ['test'], subtasks: [{ title: 'Sub' }] },
                    { title: 'Another minimal' },
                ],
            }));

            expect(result.valid).toBe(true);
            expect(result.tasks).toHaveLength(3);
            expect(result.tasks?.[1].subtasks).toHaveLength(1);
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
