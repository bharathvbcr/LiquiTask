import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../debounce';

describe('debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should delay function execution', () => {
        const func = vi.fn();
        const debouncedFunc = debounce(func, 100);

        debouncedFunc();
        expect(func).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous call if called again before delay', () => {
        const func = vi.fn();
        const debouncedFunc = debounce(func, 100);

        debouncedFunc();
        vi.advanceTimersByTime(50);

        debouncedFunc();
        vi.advanceTimersByTime(50);

        expect(func).not.toHaveBeenCalled();

        vi.advanceTimersByTime(50);
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to debounced function', () => {
        const func = vi.fn();
        const debouncedFunc = debounce(func, 100);

        debouncedFunc('arg1', 'arg2', 123);
        vi.advanceTimersByTime(100);

        expect(func).toHaveBeenCalledWith('arg1', 'arg2', 123);
    });

    it('should handle multiple rapid calls', () => {
        const func = vi.fn();
        const debouncedFunc = debounce(func, 100);

        debouncedFunc();
        debouncedFunc();
        debouncedFunc();
        debouncedFunc();
        debouncedFunc();

        expect(func).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should execute after delay when calls stop', () => {
        const func = vi.fn();
        const debouncedFunc = debounce(func, 200);

        debouncedFunc();
        vi.advanceTimersByTime(50);
        debouncedFunc();
        vi.advanceTimersByTime(50);
        debouncedFunc();
        vi.advanceTimersByTime(50);
        debouncedFunc();

        expect(func).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200);
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should work with different wait times', () => {
        const func1 = vi.fn();
        const func2 = vi.fn();

        const debounced1 = debounce(func1, 50);
        const debounced2 = debounce(func2, 200);

        debounced1();
        debounced2();

        vi.advanceTimersByTime(50);
        expect(func1).toHaveBeenCalledTimes(1);
        expect(func2).not.toHaveBeenCalled();

        vi.advanceTimersByTime(150);
        expect(func2).toHaveBeenCalledTimes(1);
    });

    it('should handle functions that return values', () => {
        const func = vi.fn(() => 'result');
        const debouncedFunc = debounce(func, 100);

        const result = debouncedFunc();
        expect(result).toBeUndefined(); // Debounced function doesn't return value immediately

        vi.advanceTimersByTime(100);
        expect(func).toHaveBeenCalled();
    });

    it('should work with zero wait time', () => {
        const func = vi.fn();
        const debouncedFunc = debounce(func, 0);

        debouncedFunc();
        vi.advanceTimersByTime(0);

        expect(func).toHaveBeenCalledTimes(1);
    });
});

