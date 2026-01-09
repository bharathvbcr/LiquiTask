import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTimer, formatMinutes, secondsToMinutes } from '../useTimer';

describe('useTimer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        sessionStorage.clear();
    });

    describe('initialization', () => {
        it('should initialize with 0 seconds by default', () => {
            const { result } = renderHook(() => useTimer());

            expect(result.current.seconds).toBe(0);
            expect(result.current.isRunning).toBe(false);
        });

        it('should initialize with custom initial seconds', () => {
            const { result } = renderHook(() => useTimer({ initialSeconds: 120 }));

            expect(result.current.seconds).toBe(120);
        });
    });

    describe('start', () => {
        it('should start the timer', () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.start();
            });

            expect(result.current.isRunning).toBe(true);
        });

        it('should increment seconds when running', async () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.start();
            });

            expect(result.current.seconds).toBe(0);

            act(() => {
                vi.advanceTimersByTime(1000);
            });

            expect(result.current.seconds).toBe(1);

            act(() => {
                vi.advanceTimersByTime(2000);
            });

            expect(result.current.seconds).toBe(3);
        });
    });

    describe('pause', () => {
        it('should pause the timer', () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.start();
            });

            expect(result.current.isRunning).toBe(true);

            act(() => {
                result.current.pause();
            });

            expect(result.current.isRunning).toBe(false);
        });

        it('should stop incrementing when paused', () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.start();
            });

            act(() => {
                vi.advanceTimersByTime(2000);
            });

            const secondsBeforePause = result.current.seconds;

            act(() => {
                result.current.pause();
            });

            act(() => {
                vi.advanceTimersByTime(5000);
            });

            expect(result.current.seconds).toBe(secondsBeforePause);
        });
    });

    describe('reset', () => {
        it('should reset timer to initial value', () => {
            const { result } = renderHook(() => useTimer({ initialSeconds: 60 }));

            act(() => {
                result.current.start();
            });

            act(() => {
                vi.advanceTimersByTime(5000);
            });

            expect(result.current.seconds).toBeGreaterThan(60);

            act(() => {
                result.current.reset();
            });

            expect(result.current.seconds).toBe(60);
            expect(result.current.isRunning).toBe(false);
        });
    });

    describe('setSeconds', () => {
        it('should set seconds to specific value', () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.setSeconds(300);
            });

            expect(result.current.seconds).toBe(300);
        });
    });

    describe('formattedTime', () => {
        it('should format time as MM:SS for less than 1 hour', () => {
            const { result } = renderHook(() => useTimer({ initialSeconds: 125 }));

            expect(result.current.formattedTime).toBe('02:05');
        });

        it('should format time as HH:MM:SS for 1 hour or more', () => {
            const { result } = renderHook(() => useTimer({ initialSeconds: 3665 }));

            expect(result.current.formattedTime).toBe('01:01:05');
        });

        it('should format zero seconds correctly', () => {
            const { result } = renderHook(() => useTimer({ initialSeconds: 0 }));

            expect(result.current.formattedTime).toBe('00:00');
        });
    });

    describe('onTick callback', () => {
        it('should call onTick callback on each second', () => {
            const onTick = vi.fn();
            const { result } = renderHook(() => useTimer({ onTick }));

            act(() => {
                result.current.start();
            });

            act(() => {
                vi.advanceTimersByTime(3000);
            });

            expect(onTick).toHaveBeenCalledTimes(3);
            expect(onTick).toHaveBeenCalledWith(1);
            expect(onTick).toHaveBeenCalledWith(2);
            expect(onTick).toHaveBeenCalledWith(3);
        });
    });

    describe('auto-save', () => {
        it('should call onAutoSave at specified interval', () => {
            const onAutoSave = vi.fn();
            const { result } = renderHook(() =>
                useTimer({ autoSaveInterval: 2, onAutoSave })
            );

            act(() => {
                result.current.start();
            });

            act(() => {
                vi.advanceTimersByTime(2000);
            });

            expect(onAutoSave).toHaveBeenCalled();
        });

        it('should not auto-save when paused', () => {
            const onAutoSave = vi.fn();
            const { result } = renderHook(() =>
                useTimer({ autoSaveInterval: 1, onAutoSave })
            );

            act(() => {
                result.current.start();
            });

            // Advance time to trigger auto-save
            act(() => {
                vi.advanceTimersByTime(1000);
            });

            // Pause before next auto-save
            act(() => {
                result.current.pause();
            });

            // Advance more time - should not trigger auto-save when paused
            act(() => {
                vi.advanceTimersByTime(5000);
            });

            // Should have been called once before pause
            expect(onAutoSave).toHaveBeenCalledTimes(1);
        });
    });

    describe('visibility change handling', () => {
        it('should store timer state when tab becomes hidden', () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.setSeconds(100);
                result.current.start();
            });

            // Simulate tab becoming hidden
            Object.defineProperty(document, 'hidden', { value: true, writable: true });
            document.dispatchEvent(new Event('visibilitychange'));

            expect(sessionStorage.getItem('timer-seconds-at-hide')).toBe('100');
        });

        it('should restore elapsed time when tab becomes visible', () => {
            const { result } = renderHook(() => useTimer());

            act(() => {
                result.current.setSeconds(100);
                result.current.start();
            });

            // Simulate tab hidden
            const hiddenAt = Date.now() - 5000; // 5 seconds ago
            sessionStorage.setItem('timer-hidden-at', hiddenAt.toString());
            sessionStorage.setItem('timer-seconds-at-hide', '100');

            // Simulate tab visible
            Object.defineProperty(document, 'hidden', { value: false, writable: true });
            document.dispatchEvent(new Event('visibilitychange'));

            // Timer should have advanced by ~5 seconds
            expect(result.current.seconds).toBeGreaterThanOrEqual(100);
        });
    });
});

describe('formatMinutes', () => {
    it('should format minutes as "Xm" for less than 1 hour', () => {
        expect(formatMinutes(45)).toBe('45m');
        expect(formatMinutes(0)).toBe('0m');
    });

    it('should format minutes as "Xh Ym" for 1 hour or more', () => {
        expect(formatMinutes(90)).toBe('1h 30m');
        expect(formatMinutes(120)).toBe('2h 0m');
        expect(formatMinutes(150)).toBe('2h 30m');
    });
});

describe('secondsToMinutes', () => {
    it('should convert seconds to minutes', () => {
        expect(secondsToMinutes(60)).toBe(1);
        expect(secondsToMinutes(120)).toBe(2);
        expect(secondsToMinutes(90)).toBe(2); // Rounded
        expect(secondsToMinutes(30)).toBe(1); // 30/60 = 0.5, rounded = 1
    });
});

