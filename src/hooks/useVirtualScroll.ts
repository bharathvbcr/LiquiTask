import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

interface VirtualScrollOptions {
    itemHeight: number;
    overscan?: number;
    containerHeight?: number;
}

interface VirtualScrollResult<T> {
    virtualItems: Array<{
        index: number;
        item: T;
        style: React.CSSProperties;
    }>;
    totalHeight: number;
    containerRef: React.RefObject<HTMLDivElement>;
    scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
}

/**
 * Hook for virtualizing large lists for performance.
 * Only renders items that are visible in the viewport + overscan buffer.
 * 
 * @param items - Full array of items to virtualize
 * @param options - Configuration options
 * @returns Virtual scroll state and helpers
 */
export function useVirtualScroll<T>(
    items: T[],
    options: VirtualScrollOptions
): VirtualScrollResult<T> {
    const { itemHeight, overscan = 3, containerHeight = 600 } = options;

    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(containerHeight);

    // Update viewport height when container resizes
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setViewportHeight(entry.contentRect.height);
            }
        });

        resizeObserver.observe(container);
        setViewportHeight(container.clientHeight);

        return () => resizeObserver.disconnect();
    }, []);

    // Handle scroll events
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            setScrollTop(container.scrollTop);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Calculate visible range
    const { startIndex, endIndex } = useMemo(() => {
        const start = Math.floor(scrollTop / itemHeight);
        const visibleCount = Math.ceil(viewportHeight / itemHeight);

        return {
            startIndex: Math.max(0, start - overscan),
            endIndex: Math.min(items.length - 1, start + visibleCount + overscan),
        };
    }, [scrollTop, viewportHeight, itemHeight, items.length, overscan]);

    // Generate virtual items with positioning
    const virtualItems = useMemo(() => {
        const visibleItems: Array<{
            index: number;
            item: T;
            style: React.CSSProperties;
        }> = [];

        for (let i = startIndex; i <= endIndex; i++) {
            visibleItems.push({
                index: i,
                item: items[i],
                style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${i * itemHeight}px)`,
                    height: itemHeight,
                },
            });
        }

        return visibleItems;
    }, [items, startIndex, endIndex, itemHeight]);

    // Total height for scroll area
    const totalHeight = items.length * itemHeight;

    // Programmatic scroll to index
    const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
        const container = containerRef.current;
        if (!container) return;

        const targetTop = index * itemHeight;
        container.scrollTo({ top: targetTop, behavior });
    }, [itemHeight]);

    return {
        virtualItems,
        totalHeight,
        containerRef,
        scrollToIndex,
    };
}

/**
 * Simplified hook for task lists with variable heights.
 * Uses an estimated average height and adjusts as items render.
 */
export function useVirtualTaskList<T extends { id: string }>(
    tasks: T[],
    estimatedHeight: number = 180
) {
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });
    const containerRef = useRef<HTMLDivElement>(null);
    const heightCache = useRef<Map<string, number>>(new Map());

    const measureItem = useCallback((id: string, height: number) => {
        heightCache.current.set(id, height);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const scrollTop = container.scrollTop;
            const viewportHeight = container.clientHeight;

            // Simple calculation based on estimated height
            const start = Math.max(0, Math.floor(scrollTop / estimatedHeight) - 2);
            const end = Math.min(
                tasks.length,
                Math.ceil((scrollTop + viewportHeight) / estimatedHeight) + 2
            );

            setVisibleRange({ start, end });
        };

        handleScroll(); // Initial calculation
        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [tasks.length, estimatedHeight]);

    const visibleTasks = useMemo(() => {
        return tasks.slice(visibleRange.start, visibleRange.end) as T[];
    }, [tasks, visibleRange]);

    const paddingTop = visibleRange.start * estimatedHeight;
    const paddingBottom = (tasks.length - visibleRange.end) * estimatedHeight;

    return {
        containerRef,
        visibleTasks,
        measureItem,
        containerStyle: {
            paddingTop,
            paddingBottom,
            minHeight: tasks.length * estimatedHeight,
        },
        allTasksCount: tasks.length,
        visibleCount: visibleTasks.length,
    };
}

export default useVirtualScroll;
