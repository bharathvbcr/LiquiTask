import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "../../services/aiService";
import { useTaskAssistant } from "../useTaskAssistant";

// Mock aiService
vi.mock("../../services/aiService", () => ({
  aiService: {
    generateAgentResponse: vi.fn(),
  },
}));

// Mock Electron API
const mockSearchFiles = vi.fn();
const mockGetPaths = vi.fn();
vi.stubGlobal("window", {
  electronAPI: {
    workspace: {
      getPaths: mockGetPaths,
      searchFiles: mockSearchFiles,
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
  },
});

describe("useTaskAssistant Hook", () => {
  const mockGenerateAgentResponse = vi.mocked(aiService.generateAgentResponse);
  const mockProps = {
    context: {
      activeProjectId: "p1",
      projects: [],
      priorities: [],
      customFields: [],
      workspacePaths: ["C:/workspace/project-a", "D:/workspace/project-b"],
    },
    allTasks: [],
    addTask: vi.fn(),
    updateTask: vi.fn(),
    searchTasks: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPaths.mockResolvedValue(["C:/workspace/global"]);
  });

  it("manages basic chat history", async () => {
    mockGenerateAgentResponse.mockResolvedValueOnce({
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
    mockGenerateAgentResponse.mockResolvedValueOnce({
      content: "",
      toolCalls: [{ name: "search_workspace", args: { query: "test" } }],
    });

    // Turn 2: AI returns final response after seeing search results
    mockGenerateAgentResponse.mockResolvedValueOnce({
      content: "I found 2 files.",
      toolCalls: [],
    });

    mockSearchFiles.mockResolvedValueOnce([
      { path: "C:/workspace/project-a/file1.md", snippet: "test match 1" },
      { path: "C:/workspace/project-a/file2.md", snippet: "test match 2" },
    ]);

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

    expect(mockSearchFiles).toHaveBeenCalledWith("test", [
      "C:/workspace/project-a",
      "D:/workspace/project-b",
    ]);
  });

  it("falls back to globally configured folders when the project has no linked folders", async () => {
    mockGetPaths.mockResolvedValueOnce(["C:/workspace/global-a", "D:/notes/global-b"]);
    mockGenerateAgentResponse.mockResolvedValueOnce({
      content: "",
      toolCalls: [{ name: "search_workspace", args: { query: "roadmap" } }],
    });
    mockGenerateAgentResponse.mockResolvedValueOnce({
      content: "I found a matching note.",
      toolCalls: [],
    });
    mockSearchFiles.mockResolvedValueOnce([
      { path: "D:/notes/global-b/roadmap.md", snippet: "roadmap details" },
    ]);

    const { result } = renderHook(() =>
      useTaskAssistant({
        ...mockProps,
        context: { ...mockProps.context, workspacePaths: [] },
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetPaths).toHaveBeenCalled();

    await act(async () => {
      await result.current.sendMessage("Search roadmap");
    });

    expect(mockSearchFiles).toHaveBeenCalledWith("roadmap", [
      "C:/workspace/global-a",
      "D:/notes/global-b",
    ]);
    expect(mockGenerateAgentResponse).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        workspacePaths: ["C:/workspace/global-a", "D:/notes/global-b"],
      }),
      [],
      expect.any(AbortSignal),
    );
    expect(result.current.messages.at(-1)?.content).toBe("I found a matching note.");
  });

  it("resets loading state and shows actionable provider errors", async () => {
    mockGenerateAgentResponse.mockRejectedValueOnce(new Error("Gemini API key is missing"));

    const { result } = renderHook(() => useTaskAssistant(mockProps));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.messages[1].status).toBe("error");
    expect(result.current.messages[1].content).toContain("Gemini API key is missing");
  });

  it("stops repeated tool-call loops with a clear error", async () => {
    mockGenerateAgentResponse.mockResolvedValue({
      content: "",
      toolCalls: [{ name: "search_workspace", args: { query: "loop" } }],
    });
    mockSearchFiles.mockResolvedValue([]);

    const { result } = renderHook(() => useTaskAssistant(mockProps));

    await act(async () => {
      await result.current.sendMessage("Search forever");
    });

    const lastMessage = result.current.messages[result.current.messages.length - 1];

    expect(mockGenerateAgentResponse).toHaveBeenCalledTimes(3);
    expect(mockSearchFiles).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSearching).toBe(false);
    expect(lastMessage.role).toBe("assistant");
    expect(lastMessage.status).toBe("error");
    expect(lastMessage.content).toContain("repeated the same tool call");
  });

  it("ignores stale responses after the chat is cleared mid-request", async () => {
    let resolveResponse: ((value: { content: string; toolCalls: never[] }) => void) | undefined;

    mockGenerateAgentResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const { result } = renderHook(() => useTaskAssistant(mockProps));

    let pendingSend: Promise<void> | undefined;

    act(() => {
      pendingSend = result.current.sendMessage("Hello");
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      result.current.clearChat();
    });

    await act(async () => {
      resolveResponse?.({ content: "Late response", toolCalls: [] });
      await pendingSend;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.messages).toHaveLength(0);
  });

  it("handles clearing chat", async () => {
    mockGenerateAgentResponse.mockResolvedValueOnce({
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
