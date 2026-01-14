import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../Button';
import React from 'react';

describe('Button', () => {
    it('should render children text', () => {
        render(<Button>Click Me</Button>);
        expect(screen.getByText('Click Me')).toBeInTheDocument();
    });

    it('should handle click events', () => {
        const handleClick = vi.fn();
        render(<Button onClick={handleClick}>Click Me</Button>);

        fireEvent.click(screen.getByText('Click Me'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should be disabled when disabled prop is true', () => {
        const handleClick = vi.fn();
        render(<Button disabled onClick={handleClick}>Click Me</Button>);

        const button = screen.getByRole('button');
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(handleClick).not.toHaveBeenCalled();
    });

    it('should show loading spinner and be disabled when isLoading is true', () => {
        const handleClick = vi.fn();
        const { container } = render(<Button isLoading onClick={handleClick}>Click Me</Button>);

        expect(container.querySelector('.animate-spin')).toBeInTheDocument();
        const button = screen.getByRole('button');
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(handleClick).not.toHaveBeenCalled();
    });

    it('should render with different variants', () => {
        const { rerender, container } = render(<Button variant="primary">Primary</Button>);
        expect(container.firstChild).toHaveClass('relative'); // Primary has relative for liquid layers

        rerender(<Button variant="secondary">Secondary</Button>);
        expect(container.firstChild).toHaveClass('bg-white/5');

        rerender(<Button variant="ghost">Ghost</Button>);
        expect(container.firstChild).toHaveClass('bg-transparent');

        rerender(<Button variant="danger">Danger</Button>);
        expect(container.firstChild).toHaveClass('text-red-500');
    });

    it('should render with different sizes', () => {
        const { rerender, container } = render(<Button size="sm">Small</Button>);
        expect(container.firstChild).toHaveClass('px-3');

        rerender(<Button size="md">Medium</Button>);
        expect(container.firstChild).toHaveClass('px-6');

        rerender(<Button size="lg">Large</Button>);
        expect(container.firstChild).toHaveClass('px-8');
    });

    it('should render with different colors in primary variant', () => {
        const { rerender, container } = render(<Button variant="primary" color="red">Red</Button>);
        expect(container.querySelector('.from-red-700')).toBeInTheDocument();

        rerender(<Button variant="primary" color="blue">Blue</Button>);
        expect(container.querySelector('.from-blue-600')).toBeInTheDocument();
    });

    it('should apply fullWidth class when fullWidth prop is true', () => {
        render(<Button fullWidth>Full Width</Button>);
        expect(screen.getByRole('button')).toHaveClass('w-full');
    });

    it('should render icon when provided and not loading', () => {
        const Icon = () => <span data-testid="test-icon">icon</span>;
        render(<Button icon={<Icon />}>With Icon</Button>);
        expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('should not render icon when loading', () => {
        const Icon = () => <span data-testid="test-icon">icon</span>;
        render(<Button isLoading icon={<Icon />}>Loading With Icon</Button>);
        expect(screen.queryByTestId('test-icon')).not.toBeInTheDocument();
    });
});
