import { GoogleGenerativeAI, ResponseSchema, SchemaType } from '@google/generative-ai';
import { z } from 'zod';
import storageService from './storageService';
import { STORAGE_KEYS } from '../constants';
import { Project, PriorityDefinition, Task, AIConfig, AITaskSchema, AIContext, AITestResult } from '../../types';
import { sanitizeUrl } from '../utils/validation';

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

// Zod schema for individual task output with repair transforms
const aiTaskZodSchema = z.object({
  reasoning: z.string().catch('').transform(s => s.trim()),
  title: z.string().catch('New Task').transform(s => s.trim() || 'New Task'),
  summary: z.string().catch('').transform(s => s.trim()),
  priority: z.string().catch('medium').transform(s => s.toLowerCase()),
  dueDate: z.string().optional().nullable().transform(val => {
      if (!val) return undefined;
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : d.toISOString();
  }),
  tags: z.array(z.string()).catch([]).transform(tags => tags.map(t => t.trim()).filter(t => t.length > 0)),
  timeEstimate: z.number().or(z.string().transform(v => parseInt(v) || 0)).catch(0).transform(v => Math.max(0, v)),
  subtasks: z.array(z.string()).catch([]).transform(sts => sts.map(s => s.trim()).filter(s => s.length > 0))
});

const aiTaskListZodSchema = z.array(aiTaskZodSchema);

/**
 * Robustly extracts JSON from a string that might contain markdown blocks or other noise.
 */
function extractJson(text: string): any {
    // Try to find JSON in markdown blocks first
    const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const content = markdownMatch ? markdownMatch[1].trim() : text.trim();
    
    try {
        return JSON.parse(content);
    } catch (e) {
        // If that fails, try to find the first '{' or '[' and last '}' or ']'
        const startBrace = content.indexOf('{');
        const startBracket = content.indexOf('[');
        const start = (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) ? startBrace : startBracket;
        
        const endBrace = content.lastIndexOf('}');
        const endBracket = content.lastIndexOf(']');
        const end = Math.max(endBrace, endBracket);
        
        if (start !== -1 && end !== -1 && end > start) {
            const potentialJson = content.substring(start, end + 1);
            try {
                return JSON.parse(potentialJson);
            } catch (innerE) {
                console.error('Failed to parse extracted JSON segment:', potentialJson);
                throw innerE;
            }
        }
        throw e;
    }
}

const isOperationalAiError = (error: unknown) =>
  error instanceof Error && (
    error.message.includes('not configured')
    || error.message.includes('timed out')
    || error.message.includes('request failed')
    || error.message.includes('API key is missing')
    || error.message.includes('not found')
    || error.message.includes('unreachable')
  );

export interface AIProvider {
  extractTasks(input: string, context: AIContext): Promise<AITaskSchema[]>;
  refineTask(input: string, draft: Partial<Task>, context: AIContext): Promise<Partial<AITaskSchema>>;
  testConnection(): Promise<AITestResult>;
  pullModel?(modelName: string, onProgress?: (status: string, percentage?: number) => void): Promise<void>;
  listModels?(): Promise<string[]>;
}

class GeminiProvider implements AIProvider {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  private getClient() {
    if (!this.config.geminiApiKey) throw new Error('Gemini API key is missing');
    return new GoogleGenerativeAI(this.config.geminiApiKey);
  }

  private getSchema(): ResponseSchema {
    return {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          summary: { type: SchemaType.STRING },
          priority: { type: SchemaType.STRING },
          dueDate: { type: SchemaType.STRING },
          tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          timeEstimate: { type: SchemaType.NUMBER },
          subtasks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
        },
        required: ['title', 'summary', 'priority', 'tags', 'timeEstimate']
      }
    };
  }

  private getRefineSchema(): ResponseSchema {
    return {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        summary: { type: SchemaType.STRING },
        priority: { type: SchemaType.STRING },
        dueDate: { type: SchemaType.STRING },
        tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        timeEstimate: { type: SchemaType.NUMBER },
        subtasks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
      }
    };
  }

  async extractTasks(input: string, context: AIContext): Promise<AITaskSchema[]> {
    const genAI = this.getClient();
    const modelName = this.config.geminiModel || DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: this.getSchema(),
        }
    });

    const systemInstruction = `Extract tasks from the following text. 
    Current Project Context: ${context.projects.find(p => p.id === context.activeProjectId)?.name || 'General'}.
    Available Priorities: ${context.priorities.map(p => p.id).join(', ')}.
    Today's Date: ${new Date().toISOString()}.`;

    const result = await model.generateContent(`${systemInstruction}\n\nInput Text:\n${input}`);
    const response = await result.response;
    const text = response.text();
    if (!text) return [];
    
    try {
        const raw = extractJson(text);
        return aiTaskListZodSchema.parse(raw) as AITaskSchema[];
    } catch (e) {
        console.error('Gemini extraction parsing failed:', e, 'Raw text:', text);
        return [];
    }
  }

  async refineTask(input: string, draft: Partial<Task>, context: AIContext): Promise<Partial<AITaskSchema>> {
    const genAI = this.getClient();
    const modelName = this.config.geminiModel || DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: this.getRefineSchema(),
        }
    });

    const systemInstruction = `Refine the following task draft based on the user instruction.
    User Instruction: ${input}
    
    Current Draft:
    ${JSON.stringify(draft, null, 2)}
    
    Available Priorities: ${context.priorities.map(p => p.id).join(', ')}.
    Today's Date: ${new Date().toISOString()}.`;

    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const text = response.text();
    if (!text) return {};
    
    try {
        const raw = extractJson(text);
        return aiTaskZodSchema.partial().parse(raw) as Partial<AITaskSchema>;
    } catch (e) {
        console.error('Gemini refinement parsing failed:', e, 'Raw text:', text);
        return {};
    }
  }

  async testConnection(): Promise<AITestResult> {
    if (!this.config.geminiApiKey) {
        return { ok: false, stage: 'config', message: 'Gemini API key is missing' };
    }
    if (!this.config.geminiModel) {
        return { ok: false, stage: 'config', message: 'Gemini model name is not configured' };
    }

    try {
      const genAI = this.getClient();
      const model = genAI.getGenerativeModel({ model: this.config.geminiModel });
      
      const result = await model.generateContent('Say "ok"');
      const response = await result.response;
      if (response.text()) {
          return { ok: true, stage: 'inference', message: `Connected to Gemini (${this.config.geminiModel})` };
      }
      return { ok: false, stage: 'inference', message: 'Gemini returned an empty response' };
    } catch (e: any) {
      console.error('Gemini connection test failed:', e);
      if (e.message?.includes('API_KEY_INVALID') || e.message?.includes('401') || e.message?.includes('403')) {
          return { ok: false, stage: 'service', message: 'Invalid Gemini API Key' };
      }
      if (e.message?.includes('404') || e.message?.includes('not found')) {
          return { ok: false, stage: 'model', message: `Gemini model "${this.config.geminiModel}" not found` };
      }
      return { ok: false, stage: 'inference', message: e.message || 'Unknown Gemini error' };
    }
  }
}

class OllamaProvider implements AIProvider {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  private getBaseUrl() {
    return sanitizeUrl(this.config.ollamaBaseUrl || 'http://localhost:11434');
  }

  private getModelName() {
    return this.config.ollamaModel?.trim();
  }

  private buildUnreachableMessage() {
    return `Ollama server unreachable at ${this.getBaseUrl()}. Ensure Ollama is running and the URL is correct.`;
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { 
        signal,
        // Short timeout for model listing to keep UI responsive
        priority: 'low'
      });
      
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      return Array.isArray(data.models) ? data.models.map((m: any) => m.name) : [];
    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
      if (e.name === 'TypeError' || e.message?.includes('Failed to fetch')) {
        throw new Error(this.buildUnreachableMessage());
      }
      throw e;
    }
  }

  async pullModel(modelName: string, onProgress?: (status: string, percentage?: number) => void, signal?: AbortSignal): Promise<void> {
    const baseUrl = this.getBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal
    });

    if (!response.ok) {
      throw new Error(`Failed to start pull: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('ReadableStream not supported');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const status = JSON.parse(line);
          if (status.error) throw new Error(status.error);
          
          let percentage = 0;
          if (status.completed && status.total) {
            percentage = Math.round((status.completed / status.total) * 100);
          }
          
          onProgress?.(status.status || 'Downloading...', percentage);
        } catch (e) {
          console.error('Error parsing pull status:', e, 'Line:', line);
        }
      }
    }
  }

  private async request(systemInstruction: string, userMessage: string): Promise<any> {
    const baseUrl = this.getBaseUrl();
    const model = this.getModelName();
    if (!model) throw new Error('Ollama model name is not configured.');

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userMessage }
          ],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.4 // Slightly higher for better reasoning flow
          }
        })
      });

      if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Ollama model "${model}" not found. Run "ollama pull ${model}" first.`);
        }
        throw new Error(`Ollama request failed: ${response.statusText}`);
      }

      const data = await response.json();
      return extractJson(data.message?.content || '');
    } catch (e: any) {
      if (e.name === 'TypeError' || e.message?.includes('Failed to fetch')) {
          throw new Error(this.buildUnreachableMessage());
      }
      throw e;
    }
  }

  async extractTasks(input: string, context: AIContext): Promise<AITaskSchema[]> {
    const systemInstruction = `You are a professional task extraction assistant. 
    Analyze the text carefully and extract ALL actionable tasks. 
    
    CRITICAL: For each task, you MUST first perform a step-by-step reasoning process in the "reasoning" field. 
    Think about:
    - What is the core action?
    - Are there dates or deadlines mentioned?
    - What tags are most relevant?
    - How complex is this (for time estimate and subtasks)?
    
    Output ONLY a valid JSON array of objects following this structure:
    {
      "reasoning": "Your step-by-step thought process for this specific task",
      "title": "Short actionable title",
      "summary": "Context or details",
      "priority": "low" | "medium" | "high",
      "dueDate": "ISO 8601 string if a date is mentioned",
      "tags": ["tag1", "tag2"],
      "timeEstimate": integer minutes,
      "subtasks": ["subtask1", "subtask2"]
    }

    Context:
    Current Workspace: ${context.projects.find(p => p.id === context.activeProjectId)?.name || 'General'}
    Available Priorities: ${context.priorities.map(p => p.id).join(', ')}
    Today's Date: ${new Date().toISOString()}`;

    const userMessage = `Text to process: "${input}"`;

    let raw: any;
    try {
        raw = await this.request(systemInstruction, userMessage);
        const rawArray = Array.isArray(raw) ? raw : [raw];
        return aiTaskListZodSchema.parse(rawArray) as AITaskSchema[];
    } catch (e) {
        if (isOperationalAiError(e)) {
            throw e;
        }
        console.error('Ollama extraction failed. Raw output:', raw, 'Error:', e);
        throw new Error('Local AI returned invalid task data. Try rephrasing your notes or check if the model is too small.');
    }
  }

  async refineTask(input: string, draft: Partial<Task>, context: AIContext): Promise<Partial<AITaskSchema>> {
    const systemInstruction = `Refine the provided task draft based on user instructions.
    First, reason through the requested changes in the "reasoning" field.
    Output ONLY a valid JSON object representing the refined fields.
    
    Context:
    Workspace: ${context.projects.find(p => p.id === context.activeProjectId)?.name || 'General'}
    Available Priorities: ${context.priorities.map(p => p.id).join(', ')}
    Today's Date: ${new Date().toISOString()}`;

    const userMessage = `Instruction: "${input}"\n\nDraft to refine:\n${JSON.stringify(draft, null, 2)}`;

    let raw: any;
    try {
        raw = await this.request(systemInstruction, userMessage);
        return aiTaskZodSchema.partial().parse(raw) as Partial<AITaskSchema>;
    } catch (e) {
        if (isOperationalAiError(e)) {
            throw e;
        }
        console.error('Ollama refinement failed. Raw output:', raw, 'Error:', e);
        return {};
    }
  }

  async testConnection(): Promise<AITestResult> {
    const baseUrl = this.config.ollamaBaseUrl || 'http://localhost:11434';
    const model = this.getModelName();
    if (!model) {
        return { ok: false, stage: 'config', message: 'Ollama model name is not configured' };
    }

    // Stage 1: Service Reachability
    try {
      const healthResponse = await fetch(`${baseUrl}/api/tags`);
      if (!healthResponse.ok) {
          return { ok: false, stage: 'service', message: `Ollama service returned ${healthResponse.status}` };
      }
      
      const tagsData = await healthResponse.json();
      const models = Array.isArray(tagsData.models) ? tagsData.models.map((m: any) => m.name) : [];
      
      // Stage 2: Model Installation Check
      const modelExists = models.some((m: string) => m === model || m.startsWith(`${model}:`));
      if (!modelExists) {
          return { ok: false, stage: 'model', message: `Model "${model}" not found in Ollama. Run "ollama pull ${model}" first.` };
      }
      
      // Stage 3: Real Inference Test
      try {
          await this.request('You are a helpful assistant. Return JSON only.', 'Say {"ok": true}');
          return { ok: true, stage: 'inference', message: `Successfully connected to Ollama (${model})` };
      } catch (e: any) {
          return { ok: false, stage: 'inference', message: e.message || 'Inference failed' };
      }

    } catch (e: any) {
      if (e.name === 'TypeError' || e.message?.includes('Failed to fetch')) {
          return { ok: false, stage: 'service', message: `Cannot reach Ollama at ${baseUrl}. Ensure Ollama is running and the URL is correct.` };
      }
      return { ok: false, stage: 'service', message: e.message || 'Unknown Ollama error' };
    }
  }
}

class AiService {
  private getProvider(): AIProvider | null {
    const config = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    if (!config) return null;

    if (config.provider === 'gemini') {
      return new GeminiProvider(config);
    } else if (config.provider === 'ollama') {
      return new OllamaProvider(config);
    }
    return null;
  }

  private validateTask(task: AITaskSchema, context: AIContext): AITaskSchema {
    // Final check to ensure priority specifically matches the context's current IDs
    const matchedPrio = context.priorities.find(p => p.id.toLowerCase() === task.priority.toLowerCase());
    
    return {
      ...task,
      priority: matchedPrio ? matchedPrio.id : (context.priorities[0]?.id || 'medium')
    };
  }

  async extractTasksFromText(input: string, context: AIContext): Promise<AITaskSchema[]> {
    const provider = this.getProvider();
    if (!provider) throw new Error('AI provider is not configured. Please go to Settings > AI.');

    const rawTasks = await provider.extractTasks(input, context);
    return rawTasks.map(t => this.validateTask(t, context));
  }

  async refineTaskDraft(input: string, draft: Partial<Task>, context: AIContext): Promise<Partial<AITaskSchema>> {
    const provider = this.getProvider();
    if (!provider) throw new Error('AI provider is not configured. Please go to Settings > AI.');

    const refined = await provider.refineTask(input, draft, context);
    
    // Partially repair priority if returned
    if (refined.priority) {
        const matched = context.priorities.find(p => p.id.toLowerCase() === refined.priority?.toLowerCase());
        refined.priority = matched ? matched.id : undefined;
    }

    return refined;
  }

  async testProviderConnection(): Promise<AITestResult> {
    const provider = this.getProvider();
    if (!provider) return { ok: false, stage: 'config', message: 'AI provider is not configured' };
    return await provider.testConnection();
  }

  async pullModel(modelName: string, onProgress?: (status: string, percentage?: number) => void): Promise<void> {
    const provider = this.getProvider();
    if (!provider || !provider.pullModel) {
      throw new Error('Current AI provider does not support model pulling.');
    }
    await provider.pullModel(modelName, onProgress);
  }

  async listModels(): Promise<string[]> {
    const provider = this.getProvider();
    if (provider && provider.listModels) {
      return await provider.listModels();
    }
    return [];
  }

  // Compatibility bridges
  async parseTaskFromText(inputText: string, activeProjectContext?: Project): Promise<any> {
      const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
      const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
      const context: AIContext = {
          activeProjectId: activeProjectContext?.id || '',
          projects,
          priorities
      };
      const tasks = await this.extractTasksFromText(inputText, context);
      if (tasks.length > 0) {
          const t = tasks[0];
          return {
              ...t,
              description: t.summary,
              dueDate: t.dueDate ? new Date(t.dueDate) : undefined
          };
      }
      return null;
  }

  async generateSubtasks(title: string, description: string): Promise<string[]> {
      const draft = { title, summary: description };
      const context: AIContext = { activeProjectId: '', projects: [], priorities: [] };
      const refined = await this.refineTaskDraft('Break this task down into subtasks', draft, context);
      return refined.subtasks || [];
  }

  async suggestMetadata(title: string, description: string, context: { projects: Project[], priorities: PriorityDefinition[] }): Promise<any> {
      const draft = { title, summary: description };
      const aiContext: AIContext = { activeProjectId: '', projects: context.projects, priorities: context.priorities };
      const refined = await this.refineTaskDraft('Suggest metadata like priority and tags', draft, aiContext);
      return refined;
  }
}

export const aiService = new AiService();
export default aiService;
