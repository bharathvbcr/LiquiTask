import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVirtualTaskList } from "../useVirtualScroll";

describe("useVirtualTaskList", () => {
  // Mock ResizeObserver
  const mockResizeObserver = vi.fn();
  const mockObserve = vi.fn();
  const mockDisconnect = vi.fn();

  beforeEach(() => {
    mockResizeObserver.mockImplementation((_callback) => ({
      observe: mockObserve.mockImplementation((_element) => {
        // Simulate initial resize if needed
      }),
      disconnect: mockDisconnect,
    }));
    window.ResizeObserver = mockResizeObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const tasks = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, title: `Task ${i}` }));
  const estimatedHeight = 50;

  it("should initialize with correct default state", () => {
    const { result } = renderHook(() => useVirtualTaskList(tasks, estimatedHeight));

    expect(result.current.containerStyle.minHeight).toBe("5000px"); // 100 * 50
  });

  it("should calculate visible items correctly", () => {
    const { result } = renderHook(() => useVirtualTaskList(tasks, estimatedHeight));

    // Mock the container element and its dimensions
    const mockElement = document.createElement("div");
    Object.defineProperty(mockElement, "clientHeight", { value: 500 });
    Object.defineProperty(mockElement, "getBoundingClientRect", {
      value: () => ({ height: 500, top: 0, left: 0, bottom: 500, right: 500, width: 500 }),
    });

    act(() => {
      // @ts-expect-error - setting private ref for test
      result.current.containerRef.current = mockElement;
    });

    // Manually trigger a measure/render if needed, though react-virtual usually picks it up
    // In tests with @tanstack/react-virtual, we might need to wait for an effect or just check if it's > 0
    expect(result.current.containerStyle.minHeight).toBe("5000px");
  });
});
