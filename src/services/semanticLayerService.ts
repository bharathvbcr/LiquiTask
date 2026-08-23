import type { AIConfig, SemanticLayerSettings } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { getHttpFetch, getRuntimeState } from "../runtime/runtimeEnvironment";
import { sanitizeUrl } from "../utils/validation";
import storageService from "./storageService";

const DEFAULT_SERVICE_URL = "http://127.0.0.1:8765";
const DEFAULT_SERVICE_PORT = 8765;
const HEALTH_TIMEOUT_MS = 2_000;
const CHAT_TIMEOUT_MS = 120_000;
const STARTUP_RETRIES = 6;
const STARTUP_RETRY_DELAY_MS = 500;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const RESTART_COOLDOWN_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEFAULT_SEMANTIC_LAYER_SETTINGS: Required<
  Pick<
    SemanticLayerSettings,
    | "enabled"
    | "serviceUrl"
    | "autoStart"
    | "cacheThreshold"
    | "cacheMaxEntries"
    | "enableCache"
    | "enableCompression"
  >
> &
  SemanticLayerSettings = {
  enabled: true,
  serviceUrl: DEFAULT_SERVICE_URL,
  autoStart: true,
  cacheThreshold: 0.88,
  cacheMaxEntries: 10_000,
  enableCache: true,
  enableCompression: true,
  smallModel: "llama3.2:1b",
  mediumModel: "llama3.2:3b",
  largeModel: "llama3.1:8b",
};

/** User-facing runtime status for settings UI. */
export type SemanticLayerRuntimeStatus = "off" | "starting" | "running" | "degraded";

export interface SemanticLayerChatRequest {
  prompt: string;
  systemPrompt?: string;
  ragDocuments?: Array<{ id: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  ollamaBaseUrl?: string;
  signal?: AbortSignal;
}

export interface SemanticLayerChatResult {
  text: string;
  cacheEntryId?: string;
  cacheHit: boolean;
  modelUsed: string;
  metrics: Record<string, unknown>;
}

export function getSemanticLayerSettings(config?: AIConfig | null): SemanticLayerSettings {
  const aiConfig =
    config ?? storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
  return {
    ...DEFAULT_SEMANTIC_LAYER_SETTINGS,
    ...aiConfig?.semanticLayer,
  };
}

export function isSemanticLayerEnabled(config?: AIConfig | null): boolean {
  const aiConfig =
    config ?? storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
  if (aiConfig?.provider !== "ollama") return false;
  const settings = getSemanticLayerSettings(aiConfig);
  return settings.enabled !== false;
}

function getServiceUrl(settings: SemanticLayerSettings): string {
  return sanitizeUrl(settings.serviceUrl || DEFAULT_SERVICE_URL);
}

function getServicePort(settings: SemanticLayerSettings): number {
  try {
    const parsed = new URL(getServiceUrl(settings));
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return DEFAULT_SERVICE_PORT;
  }
}

function readEnvAuthToken(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const fromVite = import.meta.env.VITE_LIQUITASK_SEMANTIC_AUTH_TOKEN;
    if (typeof fromVite === "string" && fromVite.length > 0) return fromVite;
  }
  return null;
}

function buildAuthHeaders(authToken: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = authToken ?? readEnvAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function rustEngineActive(): boolean {
  return getRuntimeState().kind === "tauri";
}

class SemanticLayerService {
  private available = false;
  private spawnedByApp = false;
  private authToken: string | null = null;
  private lastCacheEntryId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private status: SemanticLayerRuntimeStatus = "off";
  private statusListeners = new Set<(status: SemanticLayerRuntimeStatus) => void>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastRestartAttempt = 0;

  /** Most recent cache entry id — used by optional feedback hooks. */
  getLastCacheEntryId(): string | null {
    return this.lastCacheEntryId;
  }

  isAvailable(): boolean {
    return this.available;
  }

  getStatus(): SemanticLayerRuntimeStatus {
    return this.status;
  }

  subscribeStatus(listener: (status: SemanticLayerRuntimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Resets runtime state between unit tests. */
  resetForTests(): void {
    this.stopHealthMonitor();
    this.available = false;
    this.spawnedByApp = false;
    this.authToken = null;
    this.lastCacheEntryId = null;
    this.initPromise = null;
    this.lastRestartAttempt = 0;
    this.setStatus("off");
  }

  /** Re-run startup after settings change (e.g. enable toggle or Ollama switch). */
  async reinitialize(): Promise<void> {
    this.initPromise = null;
    this.available = false;
    await this.initialize();
  }

  startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      void this.runHealthCycle();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initializeInternal();
    return this.initPromise;
  }

  private setStatus(next: SemanticLayerRuntimeStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  private async initializeInternal(): Promise<void> {
    if (!isSemanticLayerEnabled()) {
      this.available = false;
      this.setStatus("off");
      return;
    }

    this.setStatus("starting");
    const settings = getSemanticLayerSettings();

    if (await this.healthCheck(settings)) {
      this.available = true;
      this.setStatus("running");
      await this.syncConfig(settings);
      return;
    }

    if (settings.autoStart !== false && rustEngineActive()) {
      const spawned = await this.trySpawnEngine(settings);
      if (spawned) {
        for (let attempt = 0; attempt < STARTUP_RETRIES; attempt += 1) {
          await sleep(STARTUP_RETRY_DELAY_MS);
          if (await this.healthCheck(settings)) {
            this.available = true;
            this.spawnedByApp = true;
            this.setStatus("running");
            await this.syncConfig(settings);
            return;
          }
        }
      }
    }

    this.available = false;
    this.setStatus("degraded");
  }

  private async runHealthCycle(): Promise<void> {
    if (!isSemanticLayerEnabled()) {
      if (this.available) this.available = false;
      this.setStatus("off");
      return;
    }

    const settings = getSemanticLayerSettings();
    const healthy = await this.healthCheck(settings);

    if (healthy) {
      if (!this.available) {
        this.available = true;
        await this.syncConfig(settings);
      }
      this.setStatus("running");
      return;
    }

    this.available = false;
    this.setStatus("degraded");

    if (
      settings.autoStart !== false &&
      rustEngineActive() &&
      Date.now() - this.lastRestartAttempt >= RESTART_COOLDOWN_MS
    ) {
      this.lastRestartAttempt = Date.now();
      const spawned = await this.trySpawnEngine(settings);
      if (spawned) {
        for (let attempt = 0; attempt < STARTUP_RETRIES; attempt += 1) {
          await sleep(STARTUP_RETRY_DELAY_MS);
          if (await this.healthCheck(settings)) {
            this.available = true;
            this.spawnedByApp = true;
            this.setStatus("running");
            await this.syncConfig(settings);
            return;
          }
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopHealthMonitor();
    if (!this.spawnedByApp || !rustEngineActive()) {
      this.available = false;
      this.initPromise = null;
      this.setStatus(isSemanticLayerEnabled() ? "degraded" : "off");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("semantic_layer_stop");
    } catch (error) {
      console.warn("[SemanticLayer] Failed to stop engine:", error);
    } finally {
      this.spawnedByApp = false;
      this.available = false;
      this.initPromise = null;
      this.setStatus(isSemanticLayerEnabled() ? "degraded" : "off");
    }
  }

  async chat(request: SemanticLayerChatRequest): Promise<SemanticLayerChatResult | null> {
    if (!isSemanticLayerEnabled()) return null;

    if (!this.available) {
      await this.initialize();
    }
    if (!this.available) return null;

    if (rustEngineActive()) {
      return this.chatViaRust(request);
    }

    return this.chatViaHttp(request);
  }

  async recordFeedback(accepted: boolean, similarity = 1.0): Promise<void> {
    if (!this.lastCacheEntryId || !this.available) return;

    if (rustEngineActive()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("semantic_layer_feedback", {
          request: {
            entryId: this.lastCacheEntryId,
            accepted,
            similarity,
          },
        });
      } catch (error) {
        console.warn("[SemanticLayer] Feedback request failed:", error);
      }
      return;
    }

    const settings = getSemanticLayerSettings();
    const serviceUrl = getServiceUrl(settings);

    try {
      const httpFetch = getHttpFetch();
      await httpFetch(`${serviceUrl}/v1/feedback`, {
        method: "POST",
        headers: buildAuthHeaders(this.authToken),
        body: JSON.stringify({
          entry_id: this.lastCacheEntryId,
          accepted,
          similarity,
        }),
      });
    } catch (error) {
      console.warn("[SemanticLayer] Feedback request failed:", error);
    }
  }

  private async chatViaRust(
    request: SemanticLayerChatRequest,
  ): Promise<SemanticLayerChatResult | null> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = (await invoke("semantic_layer_chat", {
        request: {
          prompt: request.prompt,
          systemPrompt: request.systemPrompt ?? "",
          ragDocuments: request.ragDocuments,
          temperature: request.temperature ?? 0.4,
          maxTokens: request.maxTokens ?? 2048,
        },
      })) as {
        text?: string;
        cacheEntryId?: string;
        cacheHit?: boolean;
        modelUsed?: string;
        metrics?: Record<string, unknown>;
      };

      if (typeof data.text !== "string") return null;

      this.lastCacheEntryId = data.cacheEntryId ?? null;
      return {
        text: data.text,
        cacheEntryId: data.cacheEntryId,
        cacheHit: Boolean(data.cacheHit),
        modelUsed: data.modelUsed ?? "",
        metrics: data.metrics ?? {},
      };
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.warn("[SemanticLayer] Rust chat failed, falling back to Ollama:", error.message);
      }
      this.available = false;
      this.setStatus("degraded");
      return null;
    }
  }

  private async chatViaHttp(
    request: SemanticLayerChatRequest,
  ): Promise<SemanticLayerChatResult | null> {
    const settings = getSemanticLayerSettings();
    const serviceUrl = getServiceUrl(settings);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    const signal = request.signal
      ? mergeAbortSignals([request.signal, controller.signal])
      : controller.signal;

    try {
      const httpFetch = getHttpFetch();
      const response = await httpFetch(`${serviceUrl}/v1/chat`, {
        method: "POST",
        headers: buildAuthHeaders(this.authToken),
        body: JSON.stringify({
          prompt: request.prompt,
          system_prompt: request.systemPrompt ?? "",
          rag_documents: request.ragDocuments,
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxTokens ?? 2048,
        }),
        signal,
      });

      if (!response.ok) {
        this.available = false;
        this.setStatus("degraded");
        return null;
      }

      const data = (await response.json()) as {
        text?: string;
        cache_entry_id?: string;
        cache_hit?: boolean;
        model_used?: string;
        metrics?: Record<string, unknown>;
      };

      if (typeof data.text !== "string") return null;

      this.lastCacheEntryId = data.cache_entry_id ?? null;
      return {
        text: data.text,
        cacheEntryId: data.cache_entry_id,
        cacheHit: Boolean(data.cache_hit),
        modelUsed: data.model_used ?? "",
        metrics: data.metrics ?? {},
      };
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.warn("[SemanticLayer] Chat request failed, falling back to Ollama:", error.message);
      }
      this.available = false;
      this.setStatus("degraded");
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async healthCheck(settings: SemanticLayerSettings): Promise<boolean> {
    if (rustEngineActive()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = (await invoke("semantic_layer_health")) as { status?: string };
        return data.status === "ok";
      } catch {
        return false;
      }
    }

    const serviceUrl = getServiceUrl(settings);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      const httpFetch = getHttpFetch();
      const response = await httpFetch(`${serviceUrl}/health`, {
        signal: controller.signal,
        headers: buildAuthHeaders(this.authToken),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async syncConfig(settings: SemanticLayerSettings): Promise<void> {
    const aiConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);

    if (rustEngineActive()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("semantic_layer_config", {
          update: {
            cacheInitialThreshold: settings.cacheThreshold,
            cacheMaxEntries: settings.cacheMaxEntries,
            enableCache: settings.enableCache,
            enableCompression: settings.enableCompression,
            smallModel: settings.smallModel,
            mediumModel: settings.mediumModel,
            largeModel: settings.largeModel ?? aiConfig?.ollamaModel,
            ollamaBaseUrl: aiConfig?.ollamaBaseUrl,
          },
        });
      } catch (error) {
        console.warn("[SemanticLayer] Config sync failed:", error);
      }
      return;
    }

    const serviceUrl = getServiceUrl(settings);

    try {
      const httpFetch = getHttpFetch();
      await httpFetch(`${serviceUrl}/v1/config`, {
        method: "POST",
        headers: buildAuthHeaders(this.authToken),
        body: JSON.stringify({
          cache_initial_threshold: settings.cacheThreshold,
          cache_max_entries: settings.cacheMaxEntries,
          enable_cache: settings.enableCache,
          enable_compression: settings.enableCompression,
          small_model: settings.smallModel,
          medium_model: settings.mediumModel,
          large_model: settings.largeModel ?? aiConfig?.ollamaModel,
          ollama_base_url: aiConfig?.ollamaBaseUrl,
        }),
      });
    } catch (error) {
      console.warn("[SemanticLayer] Config sync failed:", error);
    }
  }

  private async trySpawnEngine(settings: SemanticLayerSettings): Promise<boolean> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = (await invoke("semantic_layer_spawn", {
        port: getServicePort(settings),
        ollamaUrl: storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null)
          ?.ollamaBaseUrl,
      })) as { authToken?: string; runtime?: string };
      if (typeof result?.authToken === "string" && result.authToken.length > 0) {
        this.authToken = result.authToken;
      }
      return true;
    } catch (error) {
      console.warn("[SemanticLayer] Engine spawn unavailable:", error);
      return false;
    }
  }
}

export const semanticLayerService = new SemanticLayerService();
