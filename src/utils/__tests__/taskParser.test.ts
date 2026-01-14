import { describe, it, expect } from 'vitest';
import { parseQuickTask } from '../taskParser';

describe('taskParser', () => {
    describe('parseQuickTask', () => {
        it('should parse basic title', () => {
            const result = parseQuickTask('Simple task');
            expect(result.title).toBe('Simple task');
            expect(result.tags).toEqual([]);
        });

        it('should parse priorities', () => {
            expect(parseQuickTask('Task !h').priority).toBe('high');
            expect(parseQuickTask('Task !high').priority).toBe('high');
            expect(parseQuickTask('Task !m').priority).toBe('medium');
            expect(parseQuickTask('Task !medium').priority).toBe('medium');
            expect(parseQuickTask('Task !l').priority).toBe('low');
            expect(parseQuickTask('Task !low').priority).toBe('low');
        });

        it('should parse project', () => {
            const result = parseQuickTask('Task #work');
            expect(result.projectName).toBe('work');
            expect(result.title).toBe('Task');
        });

        it('should parse time estimates', () => {
            expect(parseQuickTask('Task ~2h').timeEstimate).toBe(120);
            expect(parseQuickTask('Task ~30m').timeEstimate).toBe(30);
            expect(parseQuickTask('Task ~1.5h').timeEstimate).toBe(90);
        });

        it('should parse tags', () => {
            const result = parseQuickTask('Task +urgent +bug');
            expect(result.tags).toEqual(['urgent', 'bug']);
            expect(result.title).toBe('Task');
        });

        it('should parse due dates', () => {
            const today = new Date();

            expect(parseQuickTask('Task @today').dueDate?.toDateString()).toBe(today.toDateString());

            const tomorrow = new Date();
            tomorrow.setDate(today.getDate() + 1);
            expect(parseQuickTask('Task @tomorrow').dueDate?.toDateString()).toBe(tomorrow.toDateString());

            const nextWeek = new Date();
            nextWeek.setDate(today.getDate() + 7);
            expect(parseQuickTask('Task @nextweek').dueDate?.toDateString()).toBe(nextWeek.toDateString());
        });

        it('should parse complex input', () => {
            const input = 'Fix bug !h #project +frontend ~1h @today';
            const result = parseQuickTask(input);

            expect(result.title).toBe('Fix bug');
            expect(result.priority).toBe('high');
            expect(result.projectName).toBe('project');
            expect(result.tags).toEqual(['frontend']);
            expect(result.timeEstimate).toBe(60);
            expect(result.dueDate).toBeDefined();
        });

        it('should clean up whitespace', () => {
            const result = parseQuickTask('  Task   !h    #p  ');
            expect(result.title).toBe('Task');
            expect(result.priority).toBe('high');
            expect(result.projectName).toBe('p');
        });
    });
});
