import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTimerOptions {
    initialSeconds?: number;
    onTick?: (seconds: number) => void;
    autoSaveInterval?: number; // Save progress every N seconds
    onAutoSave?: (seconds: number) => void;
}

interface UseTimerReturn {
    seconds: number;
    isRunning: boolean;
    start: () => void;
    pause: () => void;
    reset: () => void;
    setSeconds: (seconds: number) => void;
    formattedTime: string;
}

export function useTimer(options: UseTimerOptions = {}): UseTimerReturn {
    const {
        initialSeconds = 0,
        onTick,
        autoSaveInterval = 60,
        onAutoSave
    } = options;

    const [seconds, setSeconds] = useState(initialSeconds);
    const [isRunning, setIsRunning] = useState(false);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const autoSaveRef = useRef<NodeJS.Timeout | null>(null);

    // Format seconds as HH:MM:SS
    const formattedTime = useCallback((secs: number): string => {
        const hours = Math.floor(secs / 3600);
        const minutes = Math.floor((secs % 3600) / 60);
        const remainingSeconds = secs % 60;

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }, []);

    const start = useCallback(() => {
        if (!isRunning) {
            setIsRunning(true);
        }
    }, [isRunning]);

    const pause = useCallback(() => {
        setIsRunning(false);
    }, []);

    const reset = useCallback(() => {
        setIsRunning(false);
        setSeconds(initialSeconds);
    }, [initialSeconds]);

    // Main timer interval
    useEffect(() => {
        if (isRunning) {
            intervalRef.current = setInterval(() => {
                setSeconds(prev => {
                    const newValue = prev + 1;
                    onTick?.(newValue);
                    return newValue;
                });
            }, 1000);
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isRunning, onTick]);

    // Auto-save interval
    useEffect(() => {
        if (isRunning && autoSaveInterval > 0 && onAutoSave) {
            autoSaveRef.current = setInterval(() => {
                onAutoSave(seconds);
            }, autoSaveInterval * 1000);
        }

        return () => {
            if (autoSaveRef.current) {
                clearInterval(autoSaveRef.current);
                autoSaveRef.current = null;
            }
        };
    }, [isRunning, autoSaveInterval, onAutoSave, seconds]);

    // Persist timer state when tab is hidden/shown
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && isRunning) {
                // Store the current time when tab becomes hidden
                sessionStorage.setItem('timer-hidden-at', Date.now().toString());
                sessionStorage.setItem('timer-seconds-at-hide', seconds.toString());
            } else if (!document.hidden) {
                // Calculate elapsed time when tab becomes visible
                const hiddenAt = sessionStorage.getItem('timer-hidden-at');
                const secondsAtHide = sessionStorage.getItem('timer-seconds-at-hide');

                if (hiddenAt && secondsAtHide && isRunning) {
                    const elapsed = Math.floor((Date.now() - parseInt(hiddenAt)) / 1000);
                    setSeconds(parseInt(secondsAtHide) + elapsed);
                }

                sessionStorage.removeItem('timer-hidden-at');
                sessionStorage.removeItem('timer-seconds-at-hide');
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isRunning, seconds]);

    return {
        seconds,
        isRunning,
        start,
        pause,
        reset,
        setSeconds,
        formattedTime: formattedTime(seconds),
    };
}

// Convert minutes to formatted time string
export function formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
}

// Convert seconds to minutes (for saving to task)
export function secondsToMinutes(seconds: number): number {
    return Math.round(seconds / 60);
}
