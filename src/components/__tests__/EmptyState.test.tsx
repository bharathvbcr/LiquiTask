import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
    describe('tasks type', () => {
        it('should render tasks empty state', () => {
            render(<EmptyState type="tasks" />);

            expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
        });

        it('should display project name when provided', () => {
            render(<EmptyState type="tasks" projectName="My Project" />);

            expect(screen.getByText(/my project is empty/i)).toBeInTheDocument();
        });

        it('should call onCreateTask when button clicked', () => {
            const onCreateTask = vi.fn();

            render(<EmptyState type="tasks" onCreateTask={onCreateTask} />);

            const button = screen.getByRole('button', { name: /create task/i });
            fireEvent.click(button);

            expect(onCreateTask).toHaveBeenCalledTimes(1);
        });

        it('should call onOpenAI when AI button clicked', () => {
            const onOpenAI = vi.fn();

            render(<EmptyState type="tasks" onOpenAI={onOpenAI} />);

            const button = screen.getByRole('button', { name: /generate with ai/i });
            fireEvent.click(button);

            expect(onOpenAI).toHaveBeenCalledTimes(1);
        });

        it('should not render buttons when callbacks not provided', () => {
            render(<EmptyState type="tasks" />);

            expect(screen.queryByRole('button', { name: /create task/i })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /generate with ai/i })).not.toBeInTheDocument();
        });

        it('should display tips section', () => {
            render(<EmptyState type="tasks" />);

            expect(screen.getByText(/quick create/i)).toBeInTheDocument();
            expect(screen.getByText(/drag & drop/i)).toBeInTheDocument();
            expect(screen.getByText(/link tasks/i)).toBeInTheDocument();
        });
    });

    describe('projects type', () => {
        it('should render projects empty state', () => {
            render(<EmptyState type="projects" />);

            expect(screen.getByText(/create your first workspace/i)).toBeInTheDocument();
        });

        it('should call onCreateProject when button clicked', () => {
            const onCreateProject = vi.fn();

            render(<EmptyState type="projects" onCreateProject={onCreateProject} />);

            const button = screen.getByRole('button', { name: /create workspace/i });
            fireEvent.click(button);

            expect(onCreateProject).toHaveBeenCalledTimes(1);
        });

        it('should not render button when callback not provided', () => {
            render(<EmptyState type="projects" />);

            expect(screen.queryByRole('button', { name: /create workspace/i })).not.toBeInTheDocument();
        });
    });

    describe('search type', () => {
        it('should render search empty state', () => {
            render(<EmptyState type="search" />);

            expect(screen.getByText(/no results found/i)).toBeInTheDocument();
            expect(screen.getByText(/try adjusting your search terms/i)).toBeInTheDocument();
        });

        it('should not render any buttons', () => {
            render(<EmptyState type="search" />);

            expect(screen.queryByRole('button')).not.toBeInTheDocument();
        });
    });
});

