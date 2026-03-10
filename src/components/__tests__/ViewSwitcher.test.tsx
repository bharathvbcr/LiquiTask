import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ViewSwitcher } from '../ViewSwitcher';

// Mock Tooltip
vi.mock('../Tooltip', () => ({
    Tooltip: ({ children }: any) => <div>{children}</div>
}));

describe('ViewSwitcher', () => {
    const mockOnChange = vi.fn();

    it('renders Board and Gantt in project view', () => {
        render(
            <ViewSwitcher
                currentView="project"
                viewMode="board"
                onViewModeChange={mockOnChange}
            />
        );
        
        expect(screen.getByText('Board')).toBeInTheDocument();
        expect(screen.getByText('Gantt')).toBeInTheDocument();
        expect(screen.queryByText('Stats')).not.toBeInTheDocument();
    });

    it('renders all options in dashboard view', () => {
        render(
            <ViewSwitcher
                currentView="dashboard"
                viewMode="stats"
                onViewModeChange={mockOnChange}
            />
        );
        
        expect(screen.getByText('Stats')).toBeInTheDocument();
        expect(screen.getByText('Calendar')).toBeInTheDocument();
        expect(screen.getByText('Board')).toBeInTheDocument();
        expect(screen.getByText('Gantt')).toBeInTheDocument();
    });

    it('calls onViewModeChange when a button is clicked', () => {
        render(
            <ViewSwitcher
                currentView="project"
                viewMode="board"
                onViewModeChange={mockOnChange}
            />
        );
        
        fireEvent.click(screen.getByText('Gantt'));
        expect(mockOnChange).toHaveBeenCalledWith('gantt');
    });

    it('renders only icons in compact mode', () => {
        render(
            <ViewSwitcher
                currentView="project"
                viewMode="board"
                onViewModeChange={mockOnChange}
                isCompact={true}
            />
        );
        
        expect(screen.queryByText('Board')).not.toBeInTheDocument();
        expect(screen.queryByText('Gantt')).not.toBeInTheDocument();
    });

    it('respects hideBoardAndGantt in project view', () => {
        const { container } = render(
            <ViewSwitcher
                currentView="project"
                viewMode="board"
                onViewModeChange={mockOnChange}
                hideBoardAndGantt={true}
            />
        );
        
        expect(container.firstChild).toBeNull();
    });

    it('respects hideBoardAndGantt in dashboard view', () => {
        render(
            <ViewSwitcher
                currentView="dashboard"
                viewMode="stats"
                onViewModeChange={mockOnChange}
                hideBoardAndGantt={true}
            />
        );
        
        expect(screen.getByText('Stats')).toBeInTheDocument();
        expect(screen.getByText('Calendar')).toBeInTheDocument();
        expect(screen.queryByText('Board')).not.toBeInTheDocument();
        expect(screen.queryByText('Gantt')).not.toBeInTheDocument();
    });
});
