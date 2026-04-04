import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTaskAssistant } from "../useTaskAssistant";
import { aiService } from "../../services/aiService";

// Mock aiService
vi.mock("../../services/aiService", () => ({
  aiService: {
    generateAgentResponse: vi.fn(),
  },
}));

// Mock Electron API
const mockSearchFiles = vi.fn();
vi.stubGlobal('window', {
  electronAPI: {
    workspace: {
      searchFiles: mockSearchFiles,
      readFile: vi.fn(),
      writeFile: vi.fn(),
    }
  }
});

describe("useTaskAssistant Hook", () => {
  const mockProps = {
    context: { activeProjectId: 'p1', projects: [], priorities: [], customFields: [] },
    allTasks: [],
    addTask: vi.fn(),
    updateTask: vi.fn(),
    searchTasks: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("manages basic chat history", async () => {
    (aiService.generateAgentResponse as any).mockResolvedValueOnce({
      content: "AI Response",
      toolCalls: [],
    });

    const { result } = renderHook(() => useTaskAssistant(mockProps));
    
    await act(async () => {
      await result.current.sendMessage("Hello");
    });
    
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].content).toBe("AI Response");
    expect(result.current.messages[1].role).toBe("assistant");
  });

  it("orchestrates multi-turn tool calls", async () => {
    // Turn 1: AI calls search_workspace
    (aiService.generateAgentResponse as any).mockResolvedValueOnce({
      content: "",
      toolCalls: [{ name: "search_workspace", args: { query: "test" } }],
    });
    
    // Turn 2: AI returns final response after seeing search results
    (aiService.generateAgentResponse as any).mockResolvedValueOnce({
      content: "I found 2 files.",
      toolCalls: [],
    });

    mockSearchFiles.mockResolvedValueOnce(["file1.md", "file2.md"]);

    const { result } = renderHook(() => useTaskAssistant(mockProps));
    
    await act(async () => {
      await result.current.sendMessage("Search for test");
    });
    
    // History should be: 
    // 0. user (query)
    // 1. assistant (tool call)
    // 2. function (tool result)
    // 3. assistant (final text)
    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages[1].toolCalls).toBeDefined();
    expect(result.current.messages[2].role).toBe("function");
    expect(result.current.messages[3].content).toBe("I found 2 files.");
    
    expect(mockSearchFiles).toHaveBeenCalledWith("test");
  });

  it("handles clearing chat", async () => {
    (aiService.generateAgentResponse as any).mockResolvedValueOnce({
      content: "Response",
      toolCalls: [],
    });

    const { result } = renderHook(() => useTaskAssistant(mockProps));
    
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
