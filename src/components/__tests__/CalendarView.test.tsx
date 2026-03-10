import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CalendarView } from '../CalendarView';
import { Task } from '../../types';

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: any) => <div>{children}</div>,
    useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {} }),
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
    DragOverlay: ({ children }: any) => <div>{children}</div>,
    PointerSensor: vi.fn(),
    TouchSensor: vi.fn(),
    useSensor: vi.fn(),
    useSensors: vi.fn(),
    pointerWithin: vi.fn(),
    defaultDropAnimationSideEffects: vi.fn(),
}));

describe('CalendarView', () => {
    const mockOnTaskClick = vi.fn();
    const mockOnAddTask = vi.fn();

    const mockTasks: Task[] = [
        {
            id: '1',
            title: 'Task 1',
            dueDate: new Date(),
            priority: 'high',
        } as Task
    ];

    const mockPriorities = [
        { id: 'high', label: 'High', color: 'red' }
    ] as any;

    const baseProps = {
        tasks: mockTasks,
        priorities: mockPriorities,
        onTaskClick: mockOnTaskClick,
        onAddTask: mockOnAddTask,
    };

    it('renders the calendar with tasks', () => {
        render(<CalendarView {...baseProps} />);
        
        expect(screen.getByText('Task 1')).toBeInTheDocument();
        expect(screen.getByText(/Today/i)).toBeInTheDocument();
    });

    it('switches between month and week views', () => {
        render(<CalendarView {...baseProps} />);
        
        const weekBtn = screen.getByText(/Week/i);
        fireEvent.click(weekBtn);
        
        // In week view, grid rows should change or we can check active button style
        expect(weekBtn).toHaveClass('text-red-400');
    });

    it('navigates to next and previous months', () => {
        render(<CalendarView {...baseProps} />);
        
        const nextBtn = screen.getByLabelText(/Next/i);
        const prevBtn = screen.getByLabelText(/Previous/i);
        
        const currentMonth = screen.getByRole('heading', { level: 2 }).textContent;
        
        fireEvent.click(nextBtn);
        expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(currentMonth);
        
        fireEvent.click(prevBtn);
        expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(currentMonth);
    });

    it('calls onTaskClick when a task is clicked', () => {
        render(<CalendarView {...baseProps} />);
        
        fireEvent.click(screen.getByText('Task 1'));
        expect(mockOnTaskClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    });

    it('calls onAddTask when the add button in a cell is clicked', () => {
        render(<CalendarView {...baseProps} />);
        
        // Find all add buttons (they are initially hidden by opacity-0 but still in DOM)
        const addButtons = screen.getAllByLabelText(/Add task/i);
        fireEvent.click(addButtons[0]);
        
        expect(mockOnAddTask).toHaveBeenCalled();
    });
});
