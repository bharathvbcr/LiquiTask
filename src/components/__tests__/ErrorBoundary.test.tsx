import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';
import React from 'react';

// Component that throws an error
const ThrowError: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow = true }) => {
    if (shouldThrow) {
        throw new Error('Test error');
    }
    return <div>No error</div>;
};

describe('ErrorBoundary', () => {
    const originalError = console.error;
    const mockReload = vi.fn();

    beforeEach(() => {
        console.error = vi.fn();
        // Mock window.location.reload properly
        Object.defineProperty(window, 'location', {
            value: {
                ...window.location,
                reload: mockReload,
            },
            writable: true,
        });
    });

    afterEach(() => {
        console.error = originalError;
        mockReload.mockClear();
    });

    it('should render children when no error', () => {
        render(
            <ErrorBoundary>
                <div>Test content</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('should catch and display error', () => {
        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText(/an unexpected error occurred/i)).toBeInTheDocument();
    });

    it('should display error details in development mode', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.getByText(/error details/i)).toBeInTheDocument();

        process.env.NODE_ENV = originalEnv;
    });

    it('should not display error details in production mode', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.queryByText(/error details/i)).not.toBeInTheDocument();

        process.env.NODE_ENV = originalEnv;
    });

    it('should reset error state when Try Again clicked', async () => {
        const GoodComponent: React.FC = () => <div>No error content</div>;
        
        // Create a component that can be controlled
        let shouldThrow = true;
        const ControlledError: React.FC = () => {
            if (shouldThrow) {
                throw new Error('Test error');
            }
            return <div>No error content</div>;
        };
        
        const { rerender } = render(
            <ErrorBoundary>
                <ControlledError />
            </ErrorBoundary>
        );

        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

        const tryAgainButton = screen.getByRole('button', { name: /try again/i });
        
        // Change shouldThrow before clicking, so when ErrorBoundary resets and rerenders,
        // the component won't throw
        shouldThrow = false;
        
        // Click Try Again to reset error state
        await act(async () => {
            fireEvent.click(tryAgainButton);
            // Wait for state update
            await new Promise(resolve => setTimeout(resolve, 100));
        });
        
        // Rerender to trigger a new render cycle
        // Since hasError is now false and the component doesn't throw, it should render children
        rerender(
            <ErrorBoundary>
                <ControlledError />
            </ErrorBoundary>
        );

        // Wait for the UI to update
        await waitFor(() => {
            expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
        }, { timeout: 3000 });
        
        expect(screen.getByText('No error content')).toBeInTheDocument();
    });

    it('should reload page when Reload App clicked', () => {
        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );

        const reloadButton = screen.getByRole('button', { name: /reload app/i });
        fireEvent.click(reloadButton);

        expect(mockReload).toHaveBeenCalled();
    });

    it('should render custom fallback when provided', () => {
        const fallback = <div>Custom fallback</div>;

        render(
            <ErrorBoundary fallback={fallback}>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.getByText('Custom fallback')).toBeInTheDocument();
        expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    });

    it('should log error to console', () => {
        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(console.error).toHaveBeenCalled();
    });
});

