import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskTemplates, TaskTemplate } from '../useTaskTemplates';

describe('useTaskTemplates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    });

    it('should initialize with empty templates', () => {
        const { result } = renderHook(() => useTaskTemplates());
        expect(result.current.templates).toEqual([]);
    });

    it('should load templates from localStorage', () => {
        const storedTemplates: TaskTemplate[] = [
            {
                id: 'test-1',
                name: 'Test Template',
                taskDefaults: { title: 'Default Title', priority: 'high' },
                createdAt: new Date('2024-01-01'),
            },
        ];
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
            JSON.stringify(storedTemplates)
        );

        const { result } = renderHook(() => useTaskTemplates());
        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].name).toBe('Test Template');
    });

    it('should create a new template', () => {
        const { result } = renderHook(() => useTaskTemplates());

        act(() => {
            result.current.createTemplate(
                'New Template',
                { title: 'Task Title', priority: 'medium' },
                'A description'
            );
        });

        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].name).toBe('New Template');
        expect(result.current.templates[0].description).toBe('A description');
        expect(result.current.templates[0].taskDefaults?.title).toBe('Task Title');
    });

    it('should delete a template', () => {
        const storedTemplates: TaskTemplate[] = [
            {
                id: 'test-1',
                name: 'Template 1',
                taskDefaults: {},
                createdAt: new Date(),
            },
            {
                id: 'test-2',
                name: 'Template 2',
                taskDefaults: {},
                createdAt: new Date(),
            },
        ];
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
            JSON.stringify(storedTemplates)
        );

        const { result } = renderHook(() => useTaskTemplates());
        expect(result.current.templates).toHaveLength(2);

        act(() => {
            result.current.deleteTemplate('test-1');
        });

        expect(result.current.templates).toHaveLength(1);
        expect(result.current.templates[0].id).toBe('test-2');
    });

    it('should apply a template', () => {
        const storedTemplates: TaskTemplate[] = [
            {
                id: 'test-1',
                name: 'Bug Template',
                taskDefaults: { title: 'Bug: ', priority: 'high', tags: ['bug'] },
                createdAt: new Date(),
            },
        ];
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
            JSON.stringify(storedTemplates)
        );

        const { result } = renderHook(() => useTaskTemplates());
        const applied = result.current.applyTemplate('test-1');

        expect(applied).not.toBeNull();
        expect(applied?.title).toBe('Bug: ');
        expect(applied?.priority).toBe('high');
    });

    it('should return null when applying non-existent template', () => {
        const { result } = renderHook(() => useTaskTemplates());
        const applied = result.current.applyTemplate('non-existent');
        expect(applied).toBeNull();
    });
});
