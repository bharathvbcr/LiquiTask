import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { useRef } from "react";

/**
 * Hook for task lists with variable heights.
 * Uses @tanstack/react-virtual for high-performance rendering,
 * but outputs padding to maintain dnd-kit compatibility.
 */
export function useVirtualTaskList<T extends { id: string }>(
  tasks: T[],
  estimatedHeight: number = 180,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => estimatedHeight,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const visibleTasks = virtualItems.map((virtualItem) => tasks[virtualItem.index]);

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end 
    : 0;

  return {
    containerRef,
    visibleTasks,
    virtualizer,
    containerStyle: {
      paddingTop,
      paddingBottom,
      minHeight: `${virtualizer.getTotalSize()}px`,
    },
    allTasksCount: tasks.length,
    visibleCount: visibleTasks.length,
  };
}

export default useVirtualTaskList;
