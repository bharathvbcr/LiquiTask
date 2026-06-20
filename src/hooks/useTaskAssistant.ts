import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AIContext, AssistantMessage, Task, ToolCall } from "../../types";
import { getDesktopApi } from "../runtime/runtimeEnvironment";
import { aiService } from "../services/aiService";

interface UseTaskAssistantProps {
  context: AIContext;
  allTasks: Task[];
  addTask: (task: Partial<Task>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  searchTasks: (query: string) => string[];
}

const MAX_TOOL_TURNS = 5;
const MAX_REPEATED_TOOL_CALLS = 3;
const AI_RESPONSE_TIMEOUT_MS = 45000;

const normalizeToolValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeToolValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeToolValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
};

const getToolCallSignature = (toolCalls: ToolCall[]) =>
  JSON.stringify(
    toolCalls.map((toolCall) => ({
      name: toolCall.name,
      args: normalizeToolValue(toolCall.args),
    })),
  );

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) =>
  new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

const formatAssistantError = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message.trim() : "";

  if (!rawMessage) {
    return "I couldn't complete that request because the AI assistant hit an unexpected error.";
  }

  if (/AI provider is not configured/i.test(rawMessage)) {
    return "AI provider is not configured. Open Settings > AI and configure Gemini or Ollama.";
  }

  if (/Gemini API key is missing/i.test(rawMessage)) {
    return "Gemini API key is missing. Open Settings > AI and add a valid API key.";
  }

  if (/Ollama model name is not configured/i.test(rawMessage)) {
    return "Ollama model is not configured. Open Settings > AI and select an Ollama model.";
  }

  if (/configured AI provider does not support the assistant/i.test(rawMessage)) {
    return "The configured AI provider does not support the assistant. Switch providers in Settings > AI.";
  }

  if (/Cannot reach Ollama|Ollama server unreachable|Ollama request failed/i.test(rawMessage)) {
    return `${rawMessage} Check Settings > AI and confirm the Ollama server URL and model.`;
  }

  if (/timeout|timed out/i.test(rawMessage)) {
    return `${rawMessage} If this keeps happening, verify your AI provider connection in Settings > AI.`;
  }

  return rawMessage.endsWith(".") ? rawMessage : `${rawMessage}.`;
};

export const useTaskAssistant = ({
  context,
  allTasks,
  addTask,
  updateTask,
  searchTasks,
}: UseTaskAssistantProps) => {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [globalWorkspacePaths, setGlobalWorkspacePaths] = useState<string[]>([]);
  const runIdRef = useRef(0);

  // Keep messagesRef in sync with messages state so sendMessage always reads
  // the latest conversation history, even when called before a prior setState
  // has propagated (stale closure guard).
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    getDesktopApi()
      ?.workspace.getPaths()
      .then((paths) => {
        if (!cancelled) {
          setGlobalWorkspacePaths(Array.isArray(paths) ? paths : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGlobalWorkspacePaths([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveWorkspacePaths = useMemo(() => {
    const projectPaths = context.workspacePaths ?? [];
    return projectPaths.length > 0 ? projectPaths : globalWorkspacePaths;
  }, [context.workspacePaths, globalWorkspacePaths]);

  const effectiveContext = useMemo(
    () => ({
      ...context,
      workspacePaths: effectiveWorkspacePaths,
    }),
    [context, effectiveWorkspacePaths],
  );

  type ToolExecutionResult = {
    success?: boolean;
    message?: string;
    tasks?: string[];
    files?: WorkspaceSearchResult[];
    content?: string;
    error?: string;
  };

  const executeTool = useCallback(
    async (toolCall: ToolCall): Promise<ToolExecutionResult> => {
      const { name, args } = toolCall;
      const toolArgs = args as Partial<Task> & {
        id?: string;
        query?: string;
        path?: string;
        content?: string;
      };
      const scopePaths = effectiveContext.workspacePaths ?? [];
      setActiveTool(name);
      const workspaceApi = getDesktopApi()?.workspace;

      try {
        switch (name) {
          case "create_task":
            addTask(toolArgs);
            return {
              success: true,
              message: `Created task: ${
                typeof toolArgs.title === "string" ? toolArgs.title : "task"
              }`,
            };

          case "update_task":
            if (!toolArgs.id) {
              return { error: "Tool update_task requires an id" };
            }
            updateTask(toolArgs.id, toolArgs);
            return { success: true, message: `Updated task: ${toolArgs.id}` };

          case "search_tasks":
            return {
              tasks: typeof toolArgs.query === "string" ? searchTasks(toolArgs.query) : [],
            };

          case "search_workspace":
            if (typeof toolArgs.query !== "string" || !toolArgs.query.trim()) {
              return { error: "Tool search_workspace requires a query" };
            }
            if (!workspaceApi) {
              return { error: "Workspace tools are unavailable in this environment" };
            }
            if (scopePaths.length === 0) {
              return {
                error:
                  "No workspace folders are available. Use the folder button in the AI sidebar to link one.",
              };
            }
            setIsSearching(true);
            try {
              const files = await workspaceApi.searchFiles(toolArgs.query, scopePaths);
              return { files: files ?? [] };
            } finally {
              setIsSearching(false);
            }

          case "read_workspace_file": {
            if (!toolArgs.path) {
              return { error: "Tool read_workspace_file requires a path" };
            }
            if (!workspaceApi) {
              return { error: "Workspace tools are unavailable in this environment" };
            }
            if (scopePaths.length === 0) {
              return {
                error:
                  "No workspace folders are available. Use the folder button in the AI sidebar to link one.",
              };
            }
            const content = await workspaceApi.readFile(toolArgs.path, scopePaths);
            return { content: content ?? "" };
          }

          case "write_workspace_file":
            if (!toolArgs.path || typeof toolArgs.content !== "string") {
              return { error: "Tool write_workspace_file requires path and content" };
            }
            if (!workspaceApi) {
              return { error: "Workspace tools are unavailable in this environment" };
            }
            if (scopePaths.length === 0) {
              return {
                error:
                  "No workspace folders are available. Use the folder button in the AI sidebar to link one.",
              };
            }
            await workspaceApi.writeFile(toolArgs.path, toolArgs.content, scopePaths);
            return { success: true };

          default:
            return { error: `Tool ${name} not found` };
        }
      } catch (error: unknown) {
        console.error(`Tool execution error (${name}):`, error);
        return { error: error instanceof Error ? error.message : "Unknown tool execution error" };
      } finally {
        setActiveTool(null);
      }
    },
    [effectiveContext.workspacePaths, addTask, updateTask, searchTasks],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;
      const runId = ++runIdRef.current;
      const isCurrentRun = () => runIdRef.current === runId;

      const userMsg: AssistantMessage = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
        status: "done",
      };

      // Read from ref so we always have the latest conversation history,
      // even if a prior sendMessage call has not yet flushed its setState.
      let currentConversation = [...messagesRef.current, userMsg];
      messagesRef.current = currentConversation;
      setMessages(currentConversation);
      setIsLoading(true);

      try {
        let turn = 0;
        let previousToolSignature: string | null = null;
        let repeatedToolCount = 0;

        while (turn < MAX_TOOL_TURNS) {
          if (!isCurrentRun()) return;

          // Show RAG context indicator on the first turn (user message triggers context retrieval)
          const isFirstTurn = turn === 0;
          if (isFirstTurn) setIsSearching(true);

          let response: Awaited<ReturnType<typeof aiService.generateAgentResponse>>;
          try {
            response = await withTimeout(
              aiService.generateAgentResponse(currentConversation, effectiveContext, allTasks),
              AI_RESPONSE_TIMEOUT_MS,
              `The AI assistant timed out after ${Math.floor(AI_RESPONSE_TIMEOUT_MS / 1000)} seconds.`,
            );
          } finally {
            if (isFirstTurn) setIsSearching(false);
          }

          if (!isCurrentRun()) return;

          // If there are tool calls, we need another turn
          if (response.toolCalls && response.toolCalls.length > 0) {
            const toolSignature = getToolCallSignature(response.toolCalls);
            repeatedToolCount = toolSignature === previousToolSignature ? repeatedToolCount + 1 : 1;
            previousToolSignature = toolSignature;

            if (repeatedToolCount >= MAX_REPEATED_TOOL_CALLS) {
              throw new Error(
                `The AI assistant repeated the same tool call ${MAX_REPEATED_TOOL_CALLS} times and was stopped to prevent a loop.`,
              );
            }

            // 1. Add assistant msg with tool calls to history
            const assistantToolMsg: AssistantMessage = {
              id: `asst-${Date.now()}-${turn}`,
              role: "assistant",
              content: response.content || "",
              timestamp: new Date(),
              status: "done",
              toolCalls: response.toolCalls,
            };
            currentConversation = [...currentConversation, assistantToolMsg];
            setMessages(currentConversation);

            // 2. Execute tools
            const toolResults = await Promise.all(response.toolCalls.map(executeTool));
            if (!isCurrentRun()) return;

            // 3. Add function results to history
            const functionMsg: AssistantMessage = {
              id: `func-${Date.now()}-${turn}`,
              role: "function",
              content: "Tool execution completed.",
              timestamp: new Date(),
              status: "done",
              toolResults: response.toolCalls.map((tc, i) => ({
                name: tc.name,
                result: toolResults[i],
              })),
            };
            currentConversation = [...currentConversation, functionMsg];
            setMessages(currentConversation);

            turn++;
          } else {
            previousToolSignature = null;
            repeatedToolCount = 0;

            // No more tool calls, we are done
            const finalMsg: AssistantMessage = {
              id: `final-${Date.now()}`,
              role: "assistant",
              content:
                response.content ||
                "The AI assistant returned an empty response. Please try again with a more specific request.",
              timestamp: new Date(),
              status: "done",
            };
            if (!isCurrentRun()) return;
            setMessages((prev) => [...prev, finalMsg]);
            break;
          }
        }

        if (turn >= MAX_TOOL_TURNS) {
          throw new Error(
            `The AI assistant stopped after ${MAX_TOOL_TURNS} tool steps without finishing. Try a more specific request.`,
          );
        }
      } catch (error) {
        if (!isCurrentRun()) return;
        console.error("Assistant error:", error);
        const errorMsg: AssistantMessage = {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: formatAssistantError(error),
          timestamp: new Date(),
          status: "error",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        if (isCurrentRun()) {
          setIsSearching(false);
          setActiveTool(null);
          setIsLoading(false);
        }
      }
    },
    [allTasks, effectiveContext, executeTool, isLoading],
  );

  const clearChat = useCallback(() => {
    runIdRef.current += 1;
    messagesRef.current = [];
    setMessages([]);
    setIsLoading(false);
    setIsSearching(false);
    setActiveTool(null);
  }, []);

  return { messages, sendMessage, isLoading, isSearching, activeTool, clearChat, globalWorkspacePaths, setGlobalWorkspacePaths };
};
