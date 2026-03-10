import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { GanttView } from '../GanttView';
import { Task } from '../../types';

describe('GanttView', () => {
    const mockOnEditTask = vi.fn();
    const mockOnUpdateTask = vi.fn();

    const mockTasks: Task[] = [
        {
            id: '1',
            jobId: 'T-1',
            title: 'Task 1',
            dueDate: new Date(),
            timeEstimate: 60,
            priority: 'high',
            links: [],
        } as unknown as Task,
        {
            id: '2',
            jobId: 'T-2',
            title: 'Task 2',
            dueDate: new Date(Date.now() + 86400000), // tomorrow
            timeEstimate: 120,
            priority: 'medium',
            links: [{ targetTaskId: '1', type: 'blocked-by' }],
        } as unknown as Task
    ];

    const mockPriorities = [
        { id: 'high', label: 'High', color: 'red' },
        { id: 'medium', label: 'Medium', color: 'yellow' }
    ] as any;

    const baseProps = {
        tasks: mockTasks,
        columns: [],
        priorities: mockPriorities,
        onEditTask: mockOnEditTask,
        onUpdateTask: mockOnUpdateTask,
    };

    it('renders tasks in Gantt view', () => {
        render(<GanttView {...baseProps} />);
        
        expect(screen.getByText('Task 1')).toBeInTheDocument();
        expect(screen.getByText('Task 2')).toBeInTheDocument();
        expect(screen.getByText('T-1')).toBeInTheDocument();
        expect(screen.getByText('T-2')).toBeInTheDocument();
    });

    it('renders empty state when no tasks have due dates', () => {
        render(<GanttView {...baseProps} tasks={[]} />);
        
        expect(screen.getByText(/No tasks with due dates/i)).toBeInTheDocument();
    });

    it('calls onEditTask when a task is clicked', () => {
        render(<GanttView {...baseProps} />);
        
        fireEvent.click(screen.getByText('Task 1'));
        expect(mockOnEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    });

    it('changes date range when inputs are updated', () => {
        render(<GanttView {...baseProps} />);
        
        const startInput = screen.getByLabelText(/Start date/i);
        fireEvent.change(startInput, { target: { value: '2024-01-01' } });
        
        expect(startInput).toHaveValue('2024-01-01');
    });

    it('renders dependency indicator', () => {
        render(<GanttView {...baseProps} />);
        
        // Task 2 is blocked by Task 1
        expect(screen.getByTitle(/Blocked by 1 task/i)).toBeInTheDocument();
    });
});
