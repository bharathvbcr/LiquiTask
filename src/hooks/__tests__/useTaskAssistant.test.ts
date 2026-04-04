import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTaskAssistant } from "../useTaskAssistant";

// Mock aiService
vi.mock("../../services/aiService", () => ({
  aiService: {
    generateText: vi.fn().mockResolvedValue("AI Response"),
  },
}));

describe("useTaskAssistant Hook", () => {
  it("manages chat history", async () => {
    const { result } = renderHook(() => useTaskAssistant());
    
    await act(async () => {
      await result.current.sendMessage("Hello");
    });
    
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("Hello");
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].content).toBe("AI Response");
    expect(result.current.messages[1].role).toBe("assistant");
  });

  it("handles clearing chat", async () => {
    const { result } = renderHook(() => useTaskAssistant());
    
    await act(async () => {
      await result.current.sendMessage("Hello");
    });
    
    expect(result.current.messages).toHaveLength(2);
    
    act(() => {
      result.current.clearChat();
    });
    
    expect(result.current.messages).toHaveLength(0);
  });
});
