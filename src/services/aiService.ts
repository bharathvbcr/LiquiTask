import type {
  AICategorySuggestion,
  AIConfig,
  AIContext,
  AISuggestion,
  AITaskSchema,
  AITestResult,
  AutoOrganizeConfig,
  AutoOrganizeResult,
  DuplicateGroup,
  MergeSuggestion,
  PriorityDefinition,
  Project,
  Task,
  TaskCluster,
} from "../../types";
import { STORAGE_KEYS } from "../constants";
import { sanitizeUrl } from "../utils/validation";
import storageService from "./storageService";

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

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

  private getSchema(): any {
    return {
      type: 4,
      items: {
        type: 3,
        properties: {
          title: { type: 5 },
          summary: { type: 5 },
          priority: { type: 5 },
          dueDate: { type: 5 },
          tags: { type: 4, items: { type: 5 } },
          timeEstimate: { type: 2 },
          subtasks: { type: 4, items: { type: 5 } },
        },
        required: ["title", "summary", "priority", "tags", "timeEstimate"],
      },
    };
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
    } catch (e: any) {
      if (
        e.message?.includes("API_KEY_INVALID") ||
        e.message?.includes("401") ||
        e.message?.includes("403")
      ) {
        return { ok: false, stage: "service", message: "Invalid Gemini API Key" };
      }
      if (e.message?.includes("404") || e.message?.includes("not found")) {
        return {
          ok: false,
          stage: "model",
          message: `Gemini model "${this.config.geminiModel}" not found`,
        };
      }
      return { ok: false, stage: "inference", message: e.message || "Unknown Gemini error" };
    }
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

  private async request(systemInstruction: string, userMessage: string): Promise<any> {
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
    } catch (e: any) {
      if (e.name === "TypeError" || e.message?.includes("Failed to fetch")) {
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
    } catch (e: any) {
      if (e.name === "TypeError" || e.message?.includes("Failed to fetch")) {
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
    } catch (e: any) {
      if (e.name === "TypeError" || e.message?.includes("Failed to fetch")) {
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
      return Array.isArray(data.models) ? data.models.map((m: any) => m.name) : [];
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      if (e.name === "TypeError" || e.message?.includes("Failed to fetch")) {
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
      const models = Array.isArray(tagsData.models) ? tagsData.models.map((m: any) => m.name) : [];
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
      } catch (e: any) {
        return { ok: false, stage: "inference", message: e.message || "Inference failed" };
      }
    } catch (e: any) {
      if (e.name === "TypeError" || e.message?.includes("Failed to fetch")) {
        return {
          ok: false,
          stage: "service",
          message: `Cannot reach Ollama at ${baseUrl}. Ensure Ollama is running and the URL is correct.`,
        };
      }
      return { ok: false, stage: "service", message: e.message || "Unknown Ollama error" };
    }
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

  async parseTaskFromText(inputText: string, activeProjectContext?: Project): Promise<any> {
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
  ): Promise<any> {
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
  ): Promise<Array<{ task1: Task; task2: Task; confidence: number; reasons: string[] }>> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const results: Array<{ task1: Task; task2: Task; confidence: number; reasons: string[] }> = [];

    for (const pair of taskPairs) {
      try {
        const prompt = `Analyze if these two tasks are duplicates:

Task 1: "${pair.task1.title}" - ${pair.task1.summary}
Tags: ${pair.task1.tags.join(", ")}
Project: ${context.projects.find((p) => p.id === pair.task1.projectId)?.name || "Unknown"}

Task 2: "${pair.task2.title}" - ${pair.task2.summary}
Tags: ${pair.task2.tags.join(", ")}
Project: ${context.projects.find((p) => p.id === pair.task2.projectId)?.name || "Unknown"}

Return JSON: {"confidence": 0.0-1.0, "reasons": ["reason1", "reason2"]}`;

        const refined = await provider.refineTask(prompt, {}, context);
        const confidence = (refined as any).confidence ?? 0.5;
        const reasons = (refined as any).reasons ?? ["AI analysis"];

        results.push({ task1: pair.task1, task2: pair.task2, confidence, reasons });
      } catch {
        const similarity = this.calculateTextSimilarity(pair.task1.title, pair.task2.title);
        results.push({
          task1: pair.task1,
          task2: pair.task2,
          confidence: similarity,
          reasons: ["Heuristic similarity score"],
        });
      }
    }

    return results;
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
      return {
        keepTaskId: (refined as any).keepTaskId ?? group.tasks[0].id,
        archiveTaskIds: (refined as any).archiveTaskIds ?? group.tasks.slice(1).map((t) => t.id),
        mergedFields: (refined as any).mergedFields ?? {},
        reasoning: (refined as any).reasoning ?? "AI merge suggestion",
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
    const results: AICategorySuggestion[] = [];

    for (let i = 0; i < allTasks.length; i += batchSize) {
      const batch = allTasks.slice(i, i + batchSize);
      const taskDetails = batch
        .map(
          (t) =>
            `ID: ${t.id}\nTitle: "${t.title}"\nSummary: ${t.summary}\nTags: ${t.tags.join(", ")}\nPriority: ${t.priority}`,
        )
        .join("\n\n");

      const prompt = `Categorize these tasks. Return JSON array: [{"taskId": "id", "suggestedTags": ["tag1"], "suggestedPriority": "priority", "confidence": 0.8, "reasoning": "why"}]\n\nTasks:\n${taskDetails}`;

      try {
        const refined = await provider.refineTask(prompt, {}, context);
        const suggestions = Array.isArray(refined) ? refined : [refined];
        suggestions.forEach((s: any) => {
          results.push({
            taskId: s.taskId,
            suggestedTags: s.suggestedTags ?? [],
            suggestedPriority: s.suggestedPriority,
            confidence: s.confidence ?? 0.6,
            reasoning: s.reasoning ?? "AI categorization",
          });
        });
      } catch (e) {
        console.error("Task categorization failed:", e);
      }
    }

    return results;
  }

  async clusterTasks(allTasks: Task[], context: AIContext): Promise<TaskCluster[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const taskDetails = allTasks
      .map((t) => `ID: ${t.id}\nTitle: "${t.title}"\nTags: ${t.tags.join(", ")}`)
      .join("\n\n");

    const prompt = `Group these tasks into clusters based on similarity. Return JSON array: [{"taskIds": ["id1", "id2"], "theme": "cluster_theme", "suggestedTags": ["tags"], "confidence": 0.8}]\n\nTasks:\n${taskDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const clusters = Array.isArray(refined) ? refined : [];
      return clusters.map((c: any, i: number) => ({
        id: `cluster-ai-${Date.now()}-${i}`,
        taskIds: c.taskIds ?? [],
        theme: c.theme ?? "Uncategorized cluster",
        suggestedTags: c.suggestedTags ?? [],
        confidence: c.confidence ?? 0.6,
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
        const daysUntilDue = t.dueDate
          ? Math.round((new Date(t.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : "none";
        const blockedBy = t.links?.filter((l) => l.type === "blocked-by").length ?? 0;
        const blocks = t.links?.filter((l) => l.type === "blocks").length ?? 0;
        return `ID: ${t.id}\nTitle: "${t.title}"\nCurrent Priority: ${t.priority}\nDue: ${daysUntilDue} days\nBlocks: ${blocks} tasks\nBlocked By: ${blockedBy} tasks`;
      })
      .join("\n\n");

    const prompt = `Suggest priority adjustments. Return JSON array: [{"taskId": "id", "suggestedValue": "new_priority", "currentValue": "old_priority", "confidence": 0.8, "reasoning": "why"}]\n\nTasks:\n${taskDetails}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      const suggestions = Array.isArray(refined) ? refined : [];
      return suggestions.map((s: any, i: number) => ({
        id: `priority-ai-${Date.now()}-${i}`,
        type: "priority" as const,
        taskId: s.taskId,
        suggestedValue: s.suggestedValue,
        currentValue: s.currentValue,
        confidence: s.confidence ?? 0.6,
        reasoning: s.reasoning ?? "AI priority suggestion",
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
      .map((t) => `"${t.title}" due: ${new Date(t.dueDate!).toLocaleDateString()}`)
      .join("\n");

    const prompt = `Suggest optimal due date for this task considering workload. Return JSON:
{"suggestedDueDate": "ISO_date", "suggestedTimeEstimate": minutes, "conflicts": ["conflict1"], "reasoning": "why"}

Current Workload:\n${workloadInfo}\n\nTask: "${task.title}" - ${task.summary}\nCurrent Estimate: ${task.timeEstimate}min`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return {
        taskId: task.id,
        suggestedDueDate: (refined as any).suggestedDueDate
          ? new Date((refined as any).suggestedDueDate)
          : undefined,
        suggestedTimeEstimate: (refined as any).suggestedTimeEstimate,
        conflicts: (refined as any).conflicts ?? [],
        reasoning: (refined as any).reasoning ?? "AI schedule suggestion",
      };
    } catch {
      return { taskId: task.id, conflicts: [], reasoning: "Schedule suggestion unavailable" };
    }
  }

  async generateInsights(allTasks: Task[], context: AIContext): Promise<any[]> {
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
      return insights.map((insight: any, i: number) => ({
        id: `insight-ai-${Date.now()}-${i}`,
        type: insight.type ?? "recommendation",
        title: insight.title ?? "AI Insight",
        description: insight.description ?? "No description",
        data: insight.data ?? {},
        timestamp: new Date(),
      }));
    } catch {
      return this.generateHeuristicInsights(stats);
    }
  }

  private generateHeuristicInsights(stats: Record<string, number>): any[] {
    const insights: any[] = [];
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
  ): Promise<{ filterGroup: any; explanation: string }> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Convert this natural language query into a filter structure. Return JSON:
{"filterGroup": {"operator": "AND", "rules": [{"field": "priority", "operator": "equals", "value": "high"}]}, "explanation": "what this query does"}

Available fields: title, priority, status, tags, dueDate, createdAt, assignee
Query: "${query}"\nToday's Date: ${new Date().toISOString()}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return {
        filterGroup: (refined as any).filterGroup ?? { operator: "AND", rules: [] },
        explanation: (refined as any).explanation ?? query,
      };
    } catch {
      return {
        filterGroup: {
          operator: "AND",
          rules: [{ field: "title", operator: "contains", value: query }],
        },
        explanation: query,
      };
    }
  }

  async suggestAssignment(task: Task, context: AIContext): Promise<AISuggestion> {
    const provider = this.getProvider();
    if (!provider) throw new Error("AI provider not configured");

    const prompt = `Suggest the best assignee for this task. Return JSON:
{"suggestedValue": "assignee_name", "currentValue": "${task.assignee}", "confidence": 0.8, "reasoning": "why"}\n\nTask: "${task.title}" - ${task.summary}`;

    try {
      const refined = await provider.refineTask(prompt, {}, context);
      return {
        id: `assign-${Date.now()}`,
        type: "assignment",
        taskId: task.id,
        suggestedValue: (refined as any).suggestedValue ?? task.assignee,
        currentValue: task.assignee,
        confidence: (refined as any).confidence ?? 0.5,
        reasoning: (refined as any).reasoning ?? "AI assignment suggestion",
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
      return (refined as any).shouldTrigger ?? false;
    } catch {
      return false;
    }
  }

  async generateTemplate(
    taskDescription: string,
    context: AIContext,
  ): Promise<{
    name: string;
    taskData: any;
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
      return {
        name: (refined as any).name ?? "AI Generated Template",
        taskData: (refined as any).taskData ?? {},
        subtasks: (refined as any).subtasks ?? [],
        tags: (refined as any).tags ?? [],
        variables: (refined as any).variables ?? [],
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
