import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskFormModal } from '../TaskFormModal';
import { Task, Attachment } from '../../src/types';

// Mock ModalWrapper since it might use portals or complex logic
vi.mock('./ModalWrapper', () => ({
    ModalWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

describe('TaskFormModal URL Sanitization', () => {
    const mockOnClose = vi.fn();
    const mockOnSubmit = vi.fn();
    const baseProps = {
        isOpen: true,
        onClose: mockOnClose,
        onSubmit: mockOnSubmit,
        projectId: 'test-project',
    };

    const createMockTask = (attachments: Attachment[]): Task => ({
        id: '1',
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
            <TaskFormModal
                {...baseProps}
                initialData={safeTask}
            />
        );

        const link = screen.getByText('Safe Link');
        expect(link).toHaveAttribute('href', 'https://example.com');
        expect(link).not.toHaveClass('cursor-not-allowed');
    });

    it('should block javascript: URLs', () => {
        const unsafeTask = createMockTask([
            { id: '2', name: 'Unsafe Link', url: 'javascript:alert(1)', type: 'link' }
        ]);

        render(
            <TaskFormModal
                {...baseProps}
                initialData={unsafeTask}
            />
        );

        const link = screen.getByText('Unsafe Link');
        expect(link).toHaveAttribute('href', '#');
        expect(link).toHaveAttribute('title', 'Unsafe URL blocked');
        expect(link).toHaveClass('cursor-not-allowed');

        // Verify click is prevented
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickEvent, 'preventDefault', { value: vi.fn() });

        fireEvent(link, clickEvent);
        expect(clickEvent.preventDefault).toHaveBeenCalled();
    });

    it('should allow mailto: links', () => {
        const mailtoTask = createMockTask([
            { id: '3', name: 'Email Link', url: 'mailto:test@example.com', type: 'link' }
        ]);

        render(
            <TaskFormModal
                {...baseProps}
                initialData={mailtoTask}
            />
        );

        const link = screen.getByText('Email Link');
        expect(link).toHaveAttribute('href', 'mailto:test@example.com');
    });
});
