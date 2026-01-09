import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from '../LoadingSpinner';

describe('LoadingSpinner', () => {
    it('should render spinner', () => {
        const { container } = render(<LoadingSpinner />);

        const spinner = container.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
    });

    it('should render with custom size', () => {
        const { container } = render(<LoadingSpinner size={48} />);

        const spinner = container.querySelector('svg');
        expect(spinner).toHaveAttribute('width', '48');
        expect(spinner).toHaveAttribute('height', '48');
    });

    it('should render with custom className', () => {
        const { container } = render(<LoadingSpinner className="custom-class" />);

        const wrapper = container.firstChild;
        expect(wrapper).toHaveClass('custom-class');
    });

    it('should display text when provided', () => {
        render(<LoadingSpinner text="Loading..." />);

        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should not display text when not provided', () => {
        const { container } = render(<LoadingSpinner />);

        const textElements = container.querySelectorAll('p');
        expect(textElements.length).toBe(0);
    });

    it('should use default size when not provided', () => {
        const { container } = render(<LoadingSpinner />);

        const spinner = container.querySelector('svg');
        expect(spinner).toHaveAttribute('width', '24');
        expect(spinner).toHaveAttribute('height', '24');
    });
});

