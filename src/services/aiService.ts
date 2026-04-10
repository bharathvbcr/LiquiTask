import type {
  AICategorySuggestion,
  AIConfig,
  AIContext,
  AIInsight,
  AISuggestion,
  AITaskSchema,
  AITestResult,
  AssistantMessage,
  AutoOrganizeConfig,
  AutoOrganizeResult,
  DuplicateGroup,
  MergeSuggestion,
  PriorityDefinition,
  Project,
  ProjectAssignment,
  Task,
  TaskCluster,
  ToolCall,
} from "../../types";
import { STORAGE_KEYS } from "../constants";
import type { FilterGroup } from "../types/queryTypes";
import { sanitizeUrl } from "../utils/validation";
import storageService from "./storageService";

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

type AIRefineResponse = Record<string, unknown>;

// Optimization: Strip unnecessary task data before sending to AI to save tokens (similar to Pydantic v2 lean models)
const stripTaskData = (task: Task): Partial<Task> => ({
  id: task.id,
  title: task.title,
  summary: task.summary,
  priority: task.priority,
  status: task.status,
  tags: task.tags,
  dueDate: task.dueDate,
  projectId: task.projectId,
});

export interface AIProvider {
  extractTasks(input: string, context: AIContext): Promise<AITaskSchema[]>;
  refineTask(
    input: string,
    draft: Partial<Task>,
    context: AIContext,
  ): Promise<Partial<AITaskSchema>>;
  testConnection(): Promise<AITestResult>;
  pullModel?(
    modelName: string,
    onProgress?: (status: string, percentage?: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  listModels?(signal?: AbortSignal): Promise<string[]>;
  analyzeTasks(
    prompt: string,
    tasks: Task[],
    context: AIContext,
    schema: Record<string, unknown>,
  ): Promise<unknown>;
  analyzeImageToTask?(imageBase64: string, context: AIContext): Promise<Partial<Task>>;
  generateAgentResponse?(
    messages: AssistantMessage[],
    context: AIContext,
    allTasks: Task[],
  ): Promise<{ content: string; toolCalls?: ToolCall[] }>;
}

class GeminiProvider implements AIProvider {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  private async getGenAI() {
    const { GoogleGenerativeAI, SchemaType } = await import("@google/generative-ai");
    if (!this.config.geminiApiKey) throw new Error("Gemini API key is missing");
    return { genAI: new GoogleGenerativeAI(this.config.geminiApiKey), SchemaType };
  }

  async analyzeImageToTask(imageBase64: string, context: AIContext): Promise<Partial<Task>> {
    const { genAI } = await this.getGenAI();
    // Vision model must be used for images
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });

    const prompt = `Analyze this image (e.g., a screenshot of a bug, a UI sketch, or text).
Create a task based on it. Return ONLY a JSON object with:
{"title": "Task title", "summary": "Detailed description or bug report extracted from image", "priority": "high|medium|low", "timeEstimate": 60, "tags": ["ui", "bug", "frontend"]}

Context Projects: ${context.projects.map((p) => p.name).join(", ")}
Priorities: ${context.priorities.map((p) => p.id).join(", ")}`;

    try {
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64.split(",")[1] || imageBase64,
            mimeType: imageBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg",
          },
        },
      ]);
      const text = result.response.text();
      return JSON.parse(text) as Partial<Task>;
    } catch (e) {
      console.error("Image analysis failed:", e);
      throw new Error("Failed to analyze image");
    }
  }

  async extractTasks(input: string, context: AIContext): Promise<AITaskSchema[]> {
    const { genAI } = await this.getGenAI();
    const modelName = this.config.geminiModel || DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
    });

    const systemInstruction = `Extract tasks from the following text. 
Current Project Context: ${context.projects.find((p) => p.id === context.activeProjectId)?.name || "General"}.
Available Priorities: ${context.priorities.map((p) => p.id).join(", ")}.
Today's Date: ${new Date().toISOString()}.`;

    const result = await model.generateContent(`${systemInstruction}\n\nInput Text:\n${input}`);
    const response = await result.response;
    const text = response.text();
    if (!text) return [];

    try {
      const raw = JSON.parse(text);
      return Array.isArray(raw) ? raw : [raw];
    } catch {
      return [];
    }
  }

  async refineTask(
    input: string,
    draft: Partial<Task>,
    context: AIContext,
  ): Promise<Partial<AITaskSchema>> {
    const { genAI } = await this.getGenAI();
    const modelName = this.config.geminiModel || DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
    });

    const systemInstruction = `Refine the following task draft based on the user instruction.
User Instruction: ${input}
Current Draft: ${JSON.stringify(draft, null, 2)}
Available Priorities: ${context.priorities.map((p) => p.id).join(", ")}.
Today's Date: ${new Date().toISOString()}.`;

    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const text = response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  async analyzeTasks(
    prompt: string,
    _tasks: Task[],
    _context: AIContext,
    _schema: Record<string, unknown>,
  ): Promise<unknown> {
    const { genAI } = await this.getGenAI();
    const modelName = this.config.geminiModel || DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      const startBrace = text.indexOf("{");
      const startBracket = text.indexOf("[");
      const start =
        startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)
          ? startBrace
          : startBracket;
      const endBrace = text.lastIndexOf("}");
      const endBracket = text.lastIndexOf("]");
      const end = Math.max(endBrace, endBracket);
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(text.substring(start, end + 1));
      }
      return null;
    }
  }

  async testConnection(): Promise<AITestResult> {
    if (!this.config.geminiApiKey) {
      return { ok: false, stage: "config", message: "Gemini API key is missing" };
    }
    if (!this.config.geminiModel) {
      return { ok: false, stage: "config", message: "Gemini model name is not configured" };
    }

    try {
      const { genAI } = await this.getGenAI();
      const model = genAI.getGenerativeModel({ model: this.config.geminiModel });
      const result = await model.generateContent('Say "ok"');
      const response = await result.response;
      if (response.text()) {
        return {
          ok: true,
          stage: "inference",
          message: `Connected to Gemini (${this.config.geminiModel})`,
        };
      }
      return { ok: false, stage: "inference", message: "Gemini returned an empty response" };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        message.includes("API_KEY_INVALID") ||
        message.includes("401") ||
        message.includes("403")
      ) {
        return { ok: false, stage: "service", message: "Invalid Gemini API Key" };
      }
      if (message.includes("404") || message.includes("not found")) {
        return {
          ok: false,
          stage: "model",
          message: `Gemini model "${this.config.geminiModel}" not found`,
        };
      }
      return { ok: false, stage: "inference", message: message || "Unknown Gemini error" };
    }
  }

  async generateAgentResponse(
    messages: AssistantMessage[],
    context: AIContext,
    allTasks: Task[],
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const { genAI } = await this.getGenAI();
    const modelName = this.config.geminiModel || DEFAULT_GEMINI_MODEL;

    const tools = [
      {
        functionDeclarations: [
          {
            name: "create_task",
            description: "Create a new task on the board",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "The title of the task" },
                summary: { type: "string", description: "A brief description of the task" },
                priority: {
                  type: "string",
                  description: "Task priority (e.g., high, medium, low)",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags for the task",
                },
                projectId: { type: "string", description: "Optional project ID to associate with" },
              },
              required: ["title"],
            },
          },
          {
            name: "update_task",
            description: "Update an existing task status or details",
            parameters: {
              type: "object",
              properties: {
                id: { type: "string", description: "The ID of the task to update" },
                status: { type: "string", description: "New status (e.g., column ID)" },
                priority: { type: "string", description: "New priority" },
                summary: { type: "string", description: "Updated summary" },
              },
              required: ["id"],
            },
          },
          {
            name: "search_tasks",
            description: "Search for tasks on the board using a query",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search term" },
              },
              required: ["query"],
            },
          },
          {
            name: "search_workspace",
            description: "Search for .md files in the connected workspace folders",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search term or filename part" },
              },
              required: ["query"],
            },
          },
          {
            name: "read_workspace_file",
            description: "Read the contents of a file from the workspace",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Full path to the file" },
              },
              required: ["path"],
            },
          },
          {
            name: "write_workspace_file",
            description: "Write or update a file in the workspace",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Full path to the file" },
                content: { type: "string", description: "Content to write" },
              },
              required: ["path", "content"],
            },
          },
        ],
      },
    ];

    const activeProjectName =
      context.projects.find((p) => p.id === context.activeProjectId)?.name || "None";
    const workspaceContext = context.workspacePaths?.length
      ? `Linked Workspace Folders: ${context.workspacePaths.join(", ")}`
      : "No workspace folders linked to this project.";
    const systemInstruction = `You are the LiquiTask AI Assistant. You help users manage their tasks and workspace.

Today's Date: ${new Date().toISOString()}
Active Project: ${activeProjectName}
Available Priorities: ${context.priorities.map((p) => p.id).join(", ")}
${workspaceContext}

When asked about tasks or files, use the provided tools. Be concise and professional.`;

    type GeminiModelOptions = Parameters<typeof genAI.getGenerativeModel>[0];
    const model = genAI.getGenerativeModel({
      model: modelName,
      tools: tools as GeminiModelOptions["tools"],
      systemInstruction,
    });

    // Build chat history — Gemini requires alternating user/model roles.
    // function-role messages (tool results) map to role "user" with functionResponse parts.
    // assistant messages with toolCalls map to role "model" with functionCall parts only.
    const history: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [];
    for (const m of messages.slice(0, -1)) {
      if (m.role === "user") {
        history.push({ role: "user", parts: [{ text: m.content || "" }] });
      } else if (m.role === "assistant") {
        const parts: Array<Record<string, unknown>> = [{ text: m.content || "" }];
        if (m.toolCalls && m.toolCalls.length > 0) {
          parts.push(
            ...m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args } })),
          );
        }
        history.push({ role: "model", parts });
      } else if (m.role === "function") {
        const parts: Array<Record<string, unknown>> = [{ text: m.content || "" }];
        if (m.toolResults && m.toolResults.length > 0) {
          parts.push(
            ...m.toolResults.map((tr) => ({
              functionResponse: { name: tr.name, response: tr.result ?? {} },
            })),
          );
        }
        history.push({ role: "user", parts });
      }
    }

    const chat = model.startChat({
      history: history as unknown as Parameters<typeof model.startChat>[0]["history"],
    });

    const lastMessage = messages[messages.length - 1];
    let sendContent: string | Array<Record<string, unknown>>;

    if (lastMessage.role === "user") {
      let contextPrefix = "";
      try {
        const { searchIndexService } = await import("./searchIndexService");
        const relevantContext = searchIndexService.getRelevantContext(
          lastMessage.content,
          allTasks,
          {
            projectId: context.activeProjectId,
          },
        );
        if (relevantContext) {
          contextPrefix = `CURRENT CONTEXT (RAG):\n${relevantContext}\n\n`;
        }
      } catch (e) {
        console.warn("RAG injection failed:", e);
      }
      sendContent = `${contextPrefix}${lastMessage.content}`;
    } else if (lastMessage.role === "function") {
      // Send function responses back to the model
      sendContent = (lastMessage.toolResults ?? []).map((tr) => ({
        functionResponse: { name: tr.name, response: tr.result ?? {} },
      }));
    } else {
      sendContent = lastMessage.content || "";
    }

    const result = await chat.sendMessage(sendContent as Parameters<typeof chat.sendMessage>[0]);
    const response = result.response;
    const toolCalls = response.functionCalls ? response.functionCalls() : [];

    return {
      content: response.text() || "",
      toolCalls: toolCalls.map((call) => ({
        name: call.name,
        args: (call.args ?? {}) as Record<string, unknown>,
      })),
    };
  }
}

class OllamaProvider implements AIProvider {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  private getBaseUrl() {
    return sanitizeUrl(this.config.ollamaBaseUrl || "http://localhost:11434");
  }

  private getModelName() {
    return this.config.ollamaModel?.trim();
  }

  private buildUnreachableMessage() {
    return `Ollama server unreachable at ${this.getBaseUrl()}. Ensure Ollama is running and the URL is correct.`;
  }

  private async request(systemInstruction: string, userMessage: string): Promise<unknown> {
    const baseUrl = this.getBaseUrl();
    const model = this.getModelName();
    if (!model) throw new Error("Ollama model name is not configured.");

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userMessage },
        ],
        stream: false,
        format: "json",
        options: { temperature: 0.4 },
      }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Ollama model "${model}" not found. Run "ollama pull ${model}" first.`);
      }
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.message?.content || "";
    try {
      return JSON.parse(content);
    } catch {
      const startBrace = content.indexOf("{");
      const startBracket = content.indexOf("[");
      const start =
        startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)
          ? startBrace
          : startBracket;
      const endBrace = content.lastIndexOf("}");
      const endBracket = content.lastIndexOf("]");
      const end = Math.max(endBrace, endBracket);
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(content.substring(start, end + 1));
      }
      throw new Error("Failed to parse Ollama response");
    }
  }

  async extractTasks(input: string, context: AIContext): Promise<AITaskSchema[]> {
    const systemInstruction = `You are a professional task extraction assistant. Analyze the text carefully and extract ALL actionable tasks. Output ONLY a valid JSON array of objects with: reasoning, title, summary, priority, dueDate, tags, timeEstimate, subtasks.
Context: Current Workspace: ${context.projects.find((p) => p.id === context.activeProjectId)?.name || "General"}
Available Priorities: ${context.priorities.map((p) => p.id).join(", ")}
Today's Date: ${new Date().toISOString()}`;

    const userMessage = `Text to process: "${input}"`;

    try {
      const raw = await this.request(systemInstruction, userMessage);
      const rawArray = Array.isArray(raw) ? raw : [raw];
      return rawArray;
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === "TypeError" || e.message?.includes("Failed to fetch"))
      ) {
        throw new Error(this.buildUnreachableMessage());
      }
      throw e;
    }
  }

  async refineTask(
    input: string,
    draft: Partial<Task>,
    context: AIContext,
  ): Promise<Partial<AITaskSchema>> {
    const systemInstruction = `Refine the provided task draft based on user instructions. Output ONLY a valid JSON object representing the refined fields.
Context: Workspace: ${context.projects.find((p) => p.id === context.activeProjectId)?.name || "General"}
Available Priorities: ${context.priorities.map((p) => p.id).join(", ")}
Today's Date: ${new Date().toISOString()}`;

    const userMessage = `Instruction: "${input}"\n\nDraft to refine:\n${JSON.stringify(draft, null, 2)}`;

    try {
      return await this.request(systemInstruction, userMessage);
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === "TypeError" || e.message?.includes("Failed to fetch"))
      ) {
        throw new Error(this.buildUnreachableMessage());
      }
      return {};
    }
  }

  async analyzeTasks(
    prompt: string,
    _tasks: Task[],
    _context: AIContext,
    _schema: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.request(
        "You are a task analysis assistant. Return ONLY valid JSON matching the requested schema.",
        prompt,
      );
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === "TypeError" || e.message?.includes("Failed to fetch"))
      ) {
        throw new Error(this.buildUnreachableMessage());
      }
      return null;
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal });
      if (!response.ok)
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      const data = await response.json();
      return Array.isArray(data.models) ? data.models.map((m: { name: string }) => m.name) : [];
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      if (
        e instanceof Error &&
        (e.name === "TypeError" || e.message?.includes("Failed to fetch"))
      ) {
        throw new Error(this.buildUnreachableMessage());
      }
      throw e;
    }
  }

  async pullModel(
    modelName: string,
    onProgress?: (status: string, percentage?: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal,
    });

    if (!response.ok) throw new Error(`Failed to start pull: ${response.statusText}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const status = JSON.parse(line);
          if (status.error) throw new Error(status.error);
          let percentage = 0;
          if (status.completed && status.total) {
            percentage = Math.round((status.completed / status.total) * 100);
          }
          onProgress?.(status.status || "Downloading...", percentage);
        } catch {
          // ignore parse errors in stream
        }
      }
    }
  }

  async testConnection(): Promise<AITestResult> {
    const baseUrl = this.config.ollamaBaseUrl || "http://localhost:11434";
    const model = this.getModelName();
    if (!model) {
      return { ok: false, stage: "config", message: "Ollama model name is not configured" };
    }

    try {
      const healthResponse = await fetch(`${baseUrl}/api/tags`);
      if (!healthResponse.ok) {
        return {
          ok: false,
          stage: "service",
          message: `Ollama service returned ${healthResponse.status}`,
        };
      }

      const tagsData = await healthResponse.json();
      const models = Array.isArray(tagsData.models)
        ? tagsData.models.map((m: { name: string }) => m.name)
        : [];
      const modelExists = models.some((m: string) => m === model || m.startsWith(`${model}:`));
      if (!modelExists) {
        return {
          ok: false,
          stage: "model",
          message: `Model "${model}" not found in Ollama. Run "ollama pull ${model}" first.`,
        };
      }

      try {
        await this.request("You are a helpful assistant. Return JSON only.", 'Say {"ok": true}');
        return {
          ok: true,
          stage: "inference",
          message: `Successfully connected to Ollama (${model})`,
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, stage: "inference", message: message || "Inference failed" };
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        e instanceof Error &&
        (e.name === "TypeError" || e.message?.includes("Failed to fetch"))
      ) {
        return {
          ok: false,
          stage: "service",
          message: `Cannot reach Ollama at ${baseUrl}. Ensure Ollama is running and the URL is correct.`,
        };
      }
      return { ok: false, stage: "service", message: message || "Unknown Ollama error" };
    }
  }

  async generateAgentResponse(
    messages: AssistantMessage[],
    context: AIContext,
    allTasks: Task[],
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const baseUrl = this.getBaseUrl();
    const model = this.getModelName();
    if (!model) throw new Error("Ollama model name is not configured.");

    const TOOL_SCHEMA = `AVAILABLE TOOLS (use one per response if needed):
- create_task: {"title": string, "summary"?: string, "priority"?: string, "tags"?: string[]}
- update_task: {"id": string, "status"?: string, "priority"?: string, "summary"?: string}
- search_tasks: {"query": string}
- search_workspace: {"query": string}
- read_workspace_file: {"path": string}
- write_workspace_file: {"path": string, "content": string}

To call a tool, respond ONLY with this JSON (no other text):
{"tool_call": {"name": "TOOL_NAME", "args": {...}}}

Otherwise respond with plain text.`;

    const activeProjectNameOllama =
      context.projects.find((p) => p.id === context.activeProjectId)?.name || "None";
    const workspaceContextOllama = context.workspacePaths?.length
      ? `Linked Workspace Folders: ${context.workspacePaths.join(", ")}`
      : "No workspace folders linked to this project.";
    const systemInstruction = `You are the LiquiTask AI Assistant. You help users manage their tasks and workspace.
Today's Date: ${new Date().toISOString()}
Active Project: ${activeProjectNameOllama}
Available Priorities: ${context.priorities.map((p) => p.id).join(", ")}
${workspaceContextOllama}

${TOOL_SCHEMA}`;

    // Convert conversation history to Ollama chat format.
    // "function" role messages (tool results) are added as user messages.
    const chatMessages: { role: string; content: string }[] = [];
    for (const m of messages.slice(0, -1)) {
      if (m.role === "user") {
        chatMessages.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const text = m.toolCalls?.length
          ? JSON.stringify({ tool_call: { name: m.toolCalls[0].name, args: m.toolCalls[0].args } })
          : m.content || "";
        chatMessages.push({ role: "assistant", content: text });
      } else if (m.role === "function") {
        const resultText = (m.toolResults ?? [])
          .map((tr) => `Tool "${tr.name}" result: ${JSON.stringify(tr.result)}`)
          .join("\n");
        chatMessages.push({ role: "user", content: resultText });
      }
    }

    const lastMsg = messages[messages.length - 1];
    let lastContent = lastMsg.content;
    if (lastMsg.role === "user") {
      try {
        const { searchIndexService } = await import("./searchIndexService");
        const relevantContext = searchIndexService.getRelevantContext(lastMsg.content, allTasks, {
          projectId: context.activeProjectId,
        });
        if (relevantContext) {
          lastContent = `CURRENT CONTEXT (RAG):\n${relevantContext}\n\n${lastMsg.content}`;
        }
      } catch (e) {
        console.warn("Ollama RAG injection failed:", e);
      }
    }
    if (lastMsg.role === "function") {
      lastContent = (lastMsg.toolResults ?? [])
        .map((tr) => `Tool "${tr.name}" result: ${JSON.stringify(tr.result)}`)
        .join("\n");
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemInstruction },
          ...chatMessages,
          { role: "user", content: lastContent },
        ],
        stream: false,
        options: { temperature: 0.4 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const rawContent: string = data.message?.content || "";

    // Try to parse as a tool call
    try {
      const start = rawContent.indexOf("{");
      const end = rawContent.lastIndexOf("}");
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(rawContent.substring(start, end + 1));
        if (parsed.tool_call?.name) {
          return {
            content: "",
            toolCalls: [{ name: parsed.tool_call.name, args: parsed.tool_call.args ?? {} }],
          };
        }
      }
    } catch {
      // Not a tool call, return as plain text
    }

    return { content: rawContent, toolCalls: [] };
  }
}

class AiService {
  private getProvider(): AIProvider | null {
    const config = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    if (!config) return null;

    if (config.provider === "gemini") {
      return new GeminiProvider(config);
    } else if (config.provider === "ollama") {
      return new OllamaProvider(config);
    }
    return null;
  }

  async extractTasksFromText(input: string, context: AIContext): Promise<AITaskSchema[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider is not configured. Please go to Settings > AI.");
    return provider.extractTasks(input, context);
  }

  async refineTaskDraft(
    input: string,
    draft: Partial<Task>,
    context: AIContext,
  ): Promise<Partial<AITaskSchema>> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider is not configured. Please go to Settings > AI.");
    return provider.refineTask(input, draft, context);
  }

  async testProviderConnection(): Promise<AITestResult> {
    const provider = this.getProvider();
    if (!provider) return { ok: false, stage: "config", message: "AI provider is not configured" };
    return await provider.testConnection();
  }

  async pullModel(
    modelName: string,
    onProgress?: (status: string, percentage?: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const provider = this.getProvider();
    if (!provider || !provider.pullModel) {
      throw new Error("Current AI provider does not support model pulling.");
    }
    await provider.pullModel(modelName, onProgress, signal);
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const provider = this.getProvider();
    if (provider?.listModels) {
      return await provider.listModels(signal);
    }
    return [];
  }

  async analyzeTasks(
    prompt: string,
    tasks: Task[],
    context: AIContext,
    schema?: Record<string, unknown>,
  ): Promise<unknown> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider is not configured.");
    return provider.analyzeTasks(prompt, tasks, context, schema || {});
  }

  async parseTaskFromText(inputText: string, activeProjectContext?: Project): Promise<unknown> {
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const context: AIContext = {
      activeProjectId: activeProjectContext?.id || "",
      projects,
      priorities,
    };
    const tasks = await this.extractTasksFromText(inputText, context);
    if (tasks.length > 0) {
      const t = tasks[0];
      return { ...t, description: t.summary, dueDate: t.dueDate ? new Date(t.dueDate) : undefined };
    }
    return null;
  }

  async generateSubtasks(title: string, description: string): Promise<string[]> {
    const draft = { title, summary: description };
    const context: AIContext = { activeProjectId: "", projects: [], priorities: [] };
    const refined = await this.refineTaskDraft(
      "Break this task down into subtasks",
      draft,
      context,
    );
    return refined.subtasks || [];
  }

  async suggestMetadata(
    title: string,
    description: string,
    context: { projects: Project[]; priorities: PriorityDefinition[] },
  ): Promise<Partial<AITaskSchema>> {
    const draft = { title, summary: description };
    const aiContext: AIContext = {
      activeProjectId: "",
      projects: context.projects,
      priorities: context.priorities,
    };
    return await this.refineTaskDraft("Suggest metadata like priority and tags", draft, aiContext);
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    const normalize = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .trim();
    const n1 = normalize(text1);
    const n2 = normalize(text2);
    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.85;
    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));
    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  async detectDuplicates(
    taskPairs: Array<{ task1: Task; task2: Task }>,
    context: AIContext,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<Array<{ task1: Task; task2: Task; confidence: number; reasons: string[] }>> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const batchSize = 5; // Process 5 pairs concurrently
    const results: Array<{ task1: Task; task2: Task; confidence: number; reasons: string[] }> = [];

    for (let i = 0; i < taskPairs.length; i += batchSize) {
      const batch = taskPairs.slice(i, i + batchSize);

      onProgress?.(i, taskPairs.length);

      const batchPromises = batch.map(async (pair) => {
        try {
          const t1 = stripTaskData(pair.task1);
          const t2 = stripTaskData(pair.task2);
          const prompt = `Analyze if these two tasks are duplicates:

Task 1: ${JSON.stringify(t1)}
Project 1: ${context.projects.find((p) => p.id === pair.task1.projectId)?.name || "Unknown"}

Task 2: ${JSON.stringify(t2)}
Project 2: ${context.projects.find((p) => p.id === pair.task2.projectId)?.name || "Unknown"}

Return JSON: {"confidence": 0.0-1.0, "reasons": ["reason1", "reason2"]}`;

          const refined = await provider.refineTask(prompt, {}, context);
          const aiResponse = refined as AIRefineResponse;
          const confidence = (aiResponse.confidence as number) ?? 0.5;
          const reasons = (aiResponse.reasons as string[]) ?? ["AI analysis"];

          return { task1: pair.task1, task2: pair.task2, confidence, reasons };
        } catch {
          const similarity = this.calculateTextSimilarity(pair.task1.title, pair.task2.title);
          return {
            task1: pair.task1,
            task2: pair.task2,
            confidence: similarity,
            reasons: ["Heuristic similarity score"],
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  async generateAgentResponse(
    messages: AssistantMessage[],
    context: AIContext,
    allTasks: Task[],
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");
    if (!provider.generateAgentResponse) {
      throw new Error("The configured AI provider does not support the assistant.");
    }
    return provider.generateAgentResponse(messages, context, allTasks);
  }

  async analyzeRedundancy(
    tasks: Task[],
    context: AIContext,
  ): Promise<{ confidence: number; reasoning: string } | null> {
    if (tasks.length < 2) return null;
    // Compare the last task (newly created) against existing ones
    const newTask = tasks[tasks.length - 1];
    const pairs = tasks
      .slice(0, -1)
      .slice(0, 5)
      .map((t) => ({ task1: newTask, task2: t }));
    const results = await this.detectDuplicates(pairs, context);
    if (results.length === 0) return null;
    const best = results.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    if (best.confidence < 0.5) return null;
    return { confidence: best.confidence, reasoning: best.reasons.join(", ") };
  }

  async suggestMerge(group: DuplicateGroup, context: AIContext): Promise<MergeSuggestion> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const taskDetails = group.tasks
      .map(
        (t, i) =>
          `Task ${i + 1}: "${t.title}" - ${t.summary}\nTags: ${t.tags.join(", ")}\nSubtasks: ${t.subtasks.length}\nPriority: ${t.priority}`,
      )
      .join("\n\n");

    const prompt = `Which task should be kept when merging these duplicates? Return JSON:
{"keepTaskId": "task_id_to_keep", "archiveTaskIds": ["ids_to_archive"], "mergedFields": {"title": "best_title", "summary": "merged_summary", "tags": ["all_tags"], "subtasks": ["all_subtasks"]}, "reasoning": "why"}

Tasks:\n${taskDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return {
        keepTaskId: (aiResponse.keepTaskId as string) ?? group.tasks[0].id,
        archiveTaskIds:
          (aiResponse.archiveTaskIds as string[]) ?? group.tasks.slice(1).map((t) => t.id),
        mergedFields: (aiResponse.mergedFields as Partial<Task>) ?? {},
        reasoning: (aiResponse.reasoning as string) ?? "AI merge suggestion",
      };
    } catch (e) {
      console.error("Merge suggestion failed:", e);
      throw e;
    }
  }

  async categorizeTasks(allTasks: Task[], context: AIContext): Promise<AICategorySuggestion[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const batchSize = 10;
    const concurrentBatches = 3; // Process 3 batches of 10 tasks concurrently
    const results: AICategorySuggestion[] = [];

    for (let i = 0; i < allTasks.length; i += batchSize * concurrentBatches) {
      const batchesToRun = [];
      for (let j = 0; j < concurrentBatches; j++) {
        const offset = i + j * batchSize;
        if (offset < allTasks.length) {
          batchesToRun.push(allTasks.slice(offset, offset + batchSize));
        }
      }

      const batchPromises = batchesToRun.map(async (batch) => {
        const taskDetails = batch.map((t) => JSON.stringify(stripTaskData(t))).join("\n\n");

        const prompt = `Categorize these tasks. Return JSON array: [{"taskId": "id", "suggestedTags": ["tag1"], "suggestedPriority": "priority", "confidence": 0.8, "reasoning": "why"}]\n\nTasks:\n${taskDetails}`;

        try {
          const refined = await provider.refineTask(prompt, {}, context);
          const suggestions = Array.isArray(refined) ? refined : [refined];
          return suggestions.map((s: AIRefineResponse) => ({
            taskId: s.taskId as string,
            suggestedTags: (s.suggestedTags as string[]) ?? [],
            suggestedPriority: s.suggestedPriority as string | undefined,
            confidence: (s.confidence as number) ?? 0.6,
            reasoning: (s.reasoning as string) ?? "AI categorization",
          }));
        } catch (e) {
          console.error("Task categorization batch failed:", e);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach((res) => {
        results.push(...res);
      });
    }

    return results;
  }

  async clusterTasks(
    allTasks: Task[],
    context: AIContext,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<TaskCluster[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    onProgress?.(0, 100);

    const taskDetails = allTasks
      .map((t) => `ID: ${t.id}\nTitle: "${t.title}"\nTags: ${t.tags.join(", ")}`)
      .join("\n\n");

    const prompt = `Group these tasks into clusters based on similarity. Return JSON array: [{"taskIds": ["id1", "id2"], "theme": "cluster_theme", "suggestedTags": ["tags"], "confidence": 0.8}]\n\nTasks:\n${taskDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      onProgress?.(100, 100);
      const clusters = Array.isArray(refined) ? refined : [];
      return clusters.map((c: AIRefineResponse, i: number) => ({
        id: `cluster-ai-${Date.now()}-${i}`,
        taskIds: (c.taskIds as string[]) ?? [],
        theme: (c.theme as string) ?? "Uncategorized cluster",
        suggestedTags: (c.suggestedTags as string[]) ?? [],
        confidence: (c.confidence as number) ?? 0.6,
      }));
    } catch (e) {
      console.error("Task clustering failed:", e);
      return [];
    }
  }

  async suggestPriorities(allTasks: Task[], context: AIContext): Promise<AISuggestion[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const taskDetails = allTasks
      .map((t) => {
        const leanTask = stripTaskData(t);
        const daysUntilDue = t.dueDate
          ? Math.round((new Date(t.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : "none";
        const blockedBy = t.links?.filter((l) => l.type === "blocked-by").length ?? 0;
        const blocks = t.links?.filter((l) => l.type === "blocks").length ?? 0;
        return `Task: ${JSON.stringify(leanTask)}\nDue: ${daysUntilDue} days\nBlocks: ${blocks} tasks\nBlocked By: ${blockedBy} tasks`;
      })
      .join("\n\n");

    const prompt = `Suggest priority adjustments. Return JSON array: [{"taskId": "id", "suggestedValue": "new_priority", "currentValue": "old_priority", "confidence": 0.8, "reasoning": "why"}]\n\nTasks:\n${taskDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const suggestions = Array.isArray(refined) ? refined : [];
      return suggestions.map((s: AIRefineResponse, i: number) => ({
        id: `priority-ai-${Date.now()}-${i}`,
        type: "priority" as const,
        taskId: s.taskId as string,
        suggestedValue: s.suggestedValue,
        currentValue: s.currentValue,
        confidence: (s.confidence as number) ?? 0.6,
        reasoning: (s.reasoning as string) ?? "AI priority suggestion",
      }));
    } catch (e) {
      console.error("Priority suggestion failed:", e);
      return [];
    }
  }

  async suggestSchedule(
    task: Task,
    allTasks: Task[],
    context: AIContext,
  ): Promise<{
    taskId: string;
    suggestedDueDate?: Date;
    suggestedTimeEstimate?: number;
    conflicts: string[];
    reasoning: string;
  }> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const workloadInfo = allTasks
      .filter((t) => t.dueDate && !t.completedAt)
      .map((t) => `"${t.title}" due: ${new Date(t.dueDate).toLocaleDateString()}`)
      .join("\n");

    const prompt = `Suggest optimal due date for this task considering workload. Return JSON:
{"suggestedDueDate": "ISO_date", "suggestedTimeEstimate": minutes, "conflicts": ["conflict1"], "reasoning": "why"}

Current Workload:\n${workloadInfo}\n\nTask: "${task.title}" - ${task.summary}\nCurrent Estimate: ${task.timeEstimate}min`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return {
        taskId: task.id,
        suggestedDueDate: (aiResponse.suggestedDueDate as string | undefined)
          ? new Date(aiResponse.suggestedDueDate as string)
          : undefined,
        suggestedTimeEstimate: aiResponse.suggestedTimeEstimate as number | undefined,
        conflicts: (aiResponse.conflicts as string[]) ?? [],
        reasoning: (aiResponse.reasoning as string) ?? "AI schedule suggestion",
      };
    } catch {
      return { taskId: task.id, conflicts: [], reasoning: "Schedule suggestion unavailable" };
    }
  }

  async generateInsights(allTasks: Task[], context: AIContext): Promise<AIInsight[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const completedTasks = allTasks.filter((t) => t.completedAt);
    const activeTasks = allTasks.filter((t) => !t.completedAt);
    const overdueTasks = activeTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date());

    const stats = {
      totalTasks: allTasks.length,
      completedTasks: completedTasks.length,
      activeTasks: activeTasks.length,
      overdueTasks: overdueTasks.length,
      highPriorityTasks: activeTasks.filter((t) => t.priority === "high").length,
    };

    const prompt = `Generate insights from these task statistics. Return JSON array:
[{"type": "productivity|bottleneck|estimate-accuracy|pattern|recommendation", "title": "insight_title", "description": "detailed_description", "data": {}, "timestamp": "ISO_date"}]\n\nStatistics:\n${JSON.stringify(stats, null, 2)}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const insights = Array.isArray(refined) ? refined : [];
      return insights.map(
        (insight: AIRefineResponse, i: number): AIInsight => ({
          id: `insight-ai-${Date.now()}-${i}`,
          type: (insight.type as AIInsight["type"]) ?? "recommendation",
          title: (insight.title as string) ?? "AI Insight",
          description: (insight.description as string) ?? "No description",
          data: (insight.data as Record<string, unknown>) ?? {},
          timestamp: new Date(),
        }),
      );
    } catch {
      return this.generateHeuristicInsights(stats);
    }
  }

  private generateHeuristicInsights(stats: Record<string, number>): AIInsight[] {
    const insights: AIInsight[] = [];
    if (stats.overdueTasks > 0) {
      insights.push({
        id: `insight-overdue-${Date.now()}`,
        type: "bottleneck",
        title: `${stats.overdueTasks} Overdue Tasks`,
        description: `You have ${stats.overdueTasks} overdue tasks.`,
        timestamp: new Date(),
      });
    }
    if (stats.highPriorityTasks > 5) {
      insights.push({
        id: `insight-priority-${Date.now()}`,
        type: "pattern",
        title: "High Priority Task Load",
        description: `You have ${stats.highPriorityTasks} high priority tasks.`,
        timestamp: new Date(),
      });
    }
    if (stats.completedTasks > 0) {
      insights.push({
        id: `insight-productivity-${Date.now()}`,
        type: "productivity",
        title: `${stats.completedTasks} Tasks Completed`,
        description: `Great progress! You've completed ${stats.completedTasks} tasks.`,
        timestamp: new Date(),
      });
    }
    return insights;
  }

  async parseNaturalQuery(
    query: string,
    context: AIContext,
  ): Promise<{ filterGroup: FilterGroup; explanation: string }> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Convert this natural language query into a filter structure. Return JSON:
{"filterGroup": {"id": "ai-query", "operator": "AND", "rules": [{"id": "r1", "field": "priority", "operator": "equals", "value": "high"}]}, "explanation": "what this query does"}

Available fields: title, priority, status, tags, dueDate, createdAt, assignee
Query: "${query}"\nToday's Date: ${new Date().toISOString()}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return {
        filterGroup: (aiResponse.filterGroup as FilterGroup) ?? {
          id: "ai-query",
          operator: "AND",
          rules: [],
        },
        explanation: (aiResponse.explanation as string) ?? query,
      };
    } catch {
      return {
        filterGroup: {
          id: "ai-query",
          operator: "AND",
          rules: [{ id: "r1", field: "title", operator: "contains", value: query }],
        },
        explanation: query,
      };
    }
  }

  async suggestProjectReassignment(
    allTasks: Task[],
    context: AIContext,
  ): Promise<ProjectAssignment[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const taskDetails = allTasks
      .slice(0, 50) // Limit to avoid context window issues
      .map(
        (t) =>
          `ID: ${t.id}\nTitle: "${t.title}"\nSummary: ${t.summary}\nTags: ${t.tags.join(", ")}`,
      )
      .join("\n\n");

    const projectDetails = context.projects.map((p) => `ID: ${p.id}\nName: "${p.name}"`).join("\n");

    const prompt = `Analyze these tasks and projects. Suggest if any tasks should be moved to a different project. Return JSON array:
[{"taskId": "id", "currentProjectId": "id", "suggestedProjectId": "id", "confidence": 0.8, "reasoning": "why"}]

Tasks:\n${taskDetails}\n\nProjects:\n${projectDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return Array.isArray(refined) ? (refined as ProjectAssignment[]) : [];
    } catch (e) {
      console.error("Project reassignment suggestion failed:", e);
      return [];
    }
  }

  async suggestNextTask(tasks: Task[], context: AIContext): Promise<AISuggestion | null> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const activeTasks = tasks.filter((t) => !t.completedAt).slice(0, 50);
    if (activeTasks.length === 0) return null;

    const taskDetails = activeTasks
      .map(
        (t) =>
          `ID: ${t.id}\nTitle: "${t.title}"\nPriority: ${t.priority}\nDue: ${t.dueDate || "None"}\nSummary: ${t.summary}`,
      )
      .join("\n\n");

    const prompt = `Analyze these tasks and suggest which one I should work on NEXT. Consider deadlines and priority. Return JSON:
{"taskId": "id", "confidence": 0.9, "reasoning": "why this is the top priority"}

Tasks:\n${taskDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return {
        id: `suggest-next-${Date.now()}`,
        type: "priority",
        taskId: (aiResponse.taskId as string) || activeTasks[0].id,
        suggestedValue: "next",
        currentValue: "pending",
        confidence: (aiResponse.confidence as number) || 0.8,
        reasoning:
          (aiResponse.reasoning as string) || "Based on your current priorities and deadlines.",
      };
    } catch (e) {
      console.error("Next task suggestion failed:", e);
      return null;
    }
  }

  async suggestTimeEstimate(task: Task, context: AIContext): Promise<number> {
    const provider = this.getProvider();
    if (!provider) return 0;

    const prompt = `Estimate the time required to complete this task in minutes. Return JSON:
{"suggestedTimeEstimate": 60, "reasoning": "why"}\n\nTask: "${task.title}"\nDescription: ${task.summary || "No description"}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return (aiResponse.suggestedTimeEstimate as number) || 0;
    } catch (e) {
      console.error("Time estimation failed:", e);
      return 0;
    }
  }

  async suggestAssignment(task: Task, context: AIContext): Promise<AISuggestion> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Suggest the best assignee for this task. Return JSON:
{"suggestedValue": "assignee_name", "currentValue": "${task.assignee}", "confidence": 0.8, "reasoning": "why"}\n\nTask: "${task.title}" - ${task.summary}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return {
        id: `assign-${Date.now()}`,
        type: "assignment",
        taskId: task.id,
        suggestedValue: (aiResponse.suggestedValue as unknown) ?? task.assignee,
        currentValue: task.assignee,
        confidence: (aiResponse.confidence as number) ?? 0.5,
        reasoning: (aiResponse.reasoning as string) ?? "AI assignment suggestion",
      };
    } catch {
      return {
        id: `assign-${Date.now()}`,
        type: "assignment",
        taskId: task.id,
        suggestedValue: task.assignee,
        currentValue: task.assignee,
        confidence: 0,
        reasoning: "Assignment suggestion unavailable",
      };
    }
  }

  async evaluateAutomationCondition(
    rule: { naturalLanguage: string; conditions: string },
    context: AIContext,
  ): Promise<boolean> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Evaluate if this automation rule should trigger. Return JSON: {"shouldTrigger": true/false, "reasoning": "why"}\n\nRule: ${rule.naturalLanguage}\nConditions: ${rule.conditions}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return (aiResponse.shouldTrigger as boolean) ?? false;
    } catch {
      return false;
    }
  }

  async parseAutomationRule(
    naturalLanguage: string,
    context: AIContext,
    availableColumns: { id: string; title: string }[],
    availablePriorities: { id: string; label: string }[],
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const columnsContext = availableColumns.map((c) => `${c.title} (ID: ${c.id})`).join(", ");
    const prioritiesContext = availablePriorities.map((p) => `${p.label} (ID: ${p.id})`).join(", ");

    const prompt = `Convert this natural language description into an automation rule structure. Return ONLY valid JSON:
{"name": "Generated Rule Name", "trigger": "onCreate|onUpdate|onMove|onComplete|onSchedule", "actions": [{"type": "setField|addTag|removeTag|moveToColumn|setPriority|notify", "field": "optional_field", "value": "value"}]}

Available columns for moveToColumn: ${columnsContext}
Available priorities for setPriority: ${prioritiesContext}
Description: "${naturalLanguage}"`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return refined as Record<string, unknown>;
    } catch {
      throw new Error("Failed to parse automation rule.");
    }
  }

  async analyzeImageToTask(imageBase64: string, context: AIContext): Promise<Partial<Task>> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");
    if (!provider.analyzeImageToTask)
      throw new Error("Current AI provider does not support image analysis.");
    return provider.analyzeImageToTask(imageBase64, context);
  }

  async smartImportFromText(text: string, context: AIContext): Promise<Partial<Task>[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `You are a data migration expert. The user provided an export (CSV or JSON) from another tool (Jira, Trello, Linear, etc.).
Extract the tasks and map them to the following schema. Return a JSON array of tasks.

Schema:
[{"title": "Task name", "summary": "Description", "priority": "high|medium|low", "status": "Pending|In Progress|Completed", "tags": ["tag1"], "timeEstimate": 60}]

Input Data:
${text.substring(0, 10000)} // Truncated for token limit

Return ONLY the JSON array.`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return Array.isArray(refined) ? refined : [];
    } catch (e) {
      console.error("Smart import failed:", e);
      return [];
    }
  }

  async generateSemanticKeywords(task: Task, context: AIContext): Promise<string[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Generate 10 semantic keywords or synonyms for this task to improve search relevance.
Task: "${task.title}" - ${task.summary}
Tags: ${task.tags.join(", ")}

Return JSON array of strings: ["keyword1", "keyword2", ...]`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return (Array.isArray(refined) ? refined : []) as string[];
    } catch {
      return [];
    }
  }

  async generateTemplate(
    taskDescription: string,
    context: AIContext,
  ): Promise<{
    name: string;
    taskData: Record<string, unknown>;
    subtasks: string[];
    tags: string[];
    variables: string[];
  }> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Generate a reusable task template from this description. Return JSON:
{"name": "template_name", "taskData": {"title": "template_title", "summary": "template_summary", "priority": "medium"}, "subtasks": ["step1", "step2"], "tags": ["tag1"], "variables": ["{{projectName}}", "{{assignee}}"]}\n\nTask Description: ${taskDescription}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const aiResponse = refined as AIRefineResponse;
      return {
        name: (aiResponse.name as string) ?? "AI Generated Template",
        taskData: (aiResponse.taskData as Record<string, unknown>) ?? {},
        subtasks: (aiResponse.subtasks as string[]) ?? [],
        tags: (aiResponse.tags as string[]) ?? [],
        variables: (aiResponse.variables as string[]) ?? [],
      };
    } catch (e) {
      console.error("Template generation failed:", e);
      throw e;
    }
  }

  getAutoOrganizeConfig(): AutoOrganizeConfig {
    const config = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    return (
      config?.autoOrganize || {
        enabled: false,
        autoApplyThreshold: 0.85,
        suggestThreshold: 0.7,
        schedule: "manual",
        operations: {
          clustering: true,
          deduplication: true,
          autoTagging: true,
          hierarchyDetection: true,
          projectAssignment: true,
          tagConsolidation: true,
        },
        excludedProjectIds: [],
        maxTasksPerBatch: 100,
      }
    );
  }

  saveAutoOrganizeConfig(config: AutoOrganizeConfig): void {
    const aiConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    const updated: AIConfig = {
      ...(aiConfig || { provider: "gemini" }),
      autoOrganize: config,
    };
    storageService.set(STORAGE_KEYS.AI_CONFIG, updated);
  }

  getOrganizeHistory(): AutoOrganizeResult[] {
    return storageService.get<AutoOrganizeResult[]>(STORAGE_KEYS.AUTO_ORGANIZE_HISTORY, []);
  }

  saveOrganizeHistory(result: AutoOrganizeResult): void {
    const history = this.getOrganizeHistory();
    history.unshift(result);
    if (history.length > 50) history.pop();
    storageService.set(STORAGE_KEYS.AUTO_ORGANIZE_HISTORY, history);
  }

  clearOrganizeCache(): void {
    storageService.remove(STORAGE_KEYS.AI_ORGANIZE_CACHE);
  }
}

export const aiService = new AiService();
export default aiService;
