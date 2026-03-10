import { describe, it, expect } from 'vitest';
import { getDueDateStatus, getPriorityIcon, getProgressStyles } from '../taskCardUtils';
import React from 'react';

describe('taskCardUtils', () => {
    describe('getDueDateStatus', () => {
        it('should return null for no due date', () => {
            expect(getDueDateStatus()).toBeNull();
        });

        it('should return overdue status for past dates', () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 2);
            const result = getDueDateStatus(pastDate);
            expect(result?.status).toBe('overdue');
            expect(result?.label).toContain('overdue');
        });

        it('should return today status for today', () => {
            const result = getDueDateStatus(new Date());
            expect(result?.status).toBe('today');
            expect(result?.label).toBe('Due Today');
        });

        it('should return tomorrow status for tomorrow', () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const result = getDueDateStatus(tomorrow);
            expect(result?.status).toBe('tomorrow');
            expect(result?.label).toBe('Due Tomorrow');
        });

        it('should return future status for future dates', () => {
            const future = new Date();
            future.setDate(future.getDate() + 5);
            const result = getDueDateStatus(future);
            expect(result?.status).toBe('future');
        });
    });

    describe('getPriorityIcon', () => {
        it('should return React element for known icons', () => {
            const icon = getPriorityIcon('alert-circle');
            expect(React.isValidElement(icon)).toBe(true);
        });

        it('should return null for unknown icons', () => {
            expect(getPriorityIcon('unknown')).toBeNull();
        });

        it('should handle all icon names', () => {
            const icons = ['alert-circle', 'clock', 'arrow-down', 'arrow-up', 'zap', 'star', 'shield', 'flame', 'alert-triangle', 'flag', 'minus'];
            icons.forEach(name => {
                expect(getPriorityIcon(name)).not.toBeNull();
            });
        });
    });

    describe('getProgressStyles', () => {
        it('should return emerald styles for 100%', () => {
            expect(getProgressStyles(100)).toContain('emerald');
        });

        it('should return blue styles for >= 66%', () => {
            expect(getProgressStyles(70)).toContain('blue');
        });

        it('should return amber styles for >= 33%', () => {
            expect(getProgressStyles(40)).toContain('amber');
        });

        it('should return red styles for < 33%', () => {
            expect(getProgressStyles(10)).toContain('red');
        });
    });
});
