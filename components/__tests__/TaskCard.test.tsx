import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskCard } from '../TaskCard';
import { Task, Attachment } from '../../src/types';

// Mock sub-components to avoid complex rendering dependencies
vi.mock('../../src/components/InlineEditable', () => ({
    InlineEditable: ({ value }: { value: string }) => <span>{value}</span>,
    InlineSelect: ({ value }: { value: string }) => <span>{value}</span>,
    InlineDatePicker: () => <span>Date</span>
}));


describe('TaskCard URL Sanitization', () => {
    const mockOnMoveTask = vi.fn();
    const mockOnEditTask = vi.fn();
    const mockOnUpdateTask = vi.fn();
    const mockOnDeleteTask = vi.fn();

    const baseProps = {
        onMoveTask: mockOnMoveTask,
        onEditTask: mockOnEditTask,
        onUpdateTask: mockOnUpdateTask,
        onDeleteTask: mockOnDeleteTask,
        priorities: [],
        allTasks: [],
    };

    const createMockTask = (attachments: Attachment[]): Task => ({
        id: '1',
        jobId: 'T-1',
        title: 'Test Task',
        columnId: 'col1',
        projectId: 'test-project',
        createdAt: new Date(),
        updatedAt: new Date(),
        attachments: attachments,
        subtasks: [],
        comments: [],
        activity: []
    } as unknown as Task);

    it('should render safe URLs correctly', () => {
        const safeTask = createMockTask([
            { id: '1', name: 'Safe Link', url: 'https://example.com', type: 'link' }
        ]);

        render(
            <TaskCard
                {...baseProps}
                task={safeTask}
            />
        );

        const link = screen.getByText('Safe Link').closest('a');
        expect(link).toHaveAttribute('href', 'https://example.com');
    });

    it('should block javascript: URLs', () => {
        const unsafeTask = createMockTask([
            { id: '2', name: 'Unsafe Link', url: 'javascript:alert(1)', type: 'link' }
        ]);

        render(
            <TaskCard
                {...baseProps}
                task={unsafeTask}
            />
        );

        const link = screen.getByText('Unsafe Link').closest('a');
        expect(link).toHaveAttribute('href', '#');
        expect(link).toHaveAttribute('title', 'Unsafe URL blocked');
        expect(link).toHaveClass('cursor-not-allowed');

        // Verify click prevents default
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickEvent, 'preventDefault', { value: vi.fn() });
        Object.defineProperty(clickEvent, 'stopPropagation', { value: vi.fn() });

        fireEvent(link!, clickEvent);
        expect(clickEvent.preventDefault).toHaveBeenCalled();
        expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });
});
