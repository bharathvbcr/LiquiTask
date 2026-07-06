import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig } from "../../../types";
import storageService from "../storageService";
import {
  DEFAULT_SEMANTIC_LAYER_SETTINGS,
  getSemanticLayerSettings,
  isSemanticLayerEnabled,
  semanticLayerService,
  type SemanticLayerRuntimeStatus,
} from "../semanticLayerService";

vi.mock("../storageService", () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  getHttpFetch: () => global.fetch,
  getRuntimeState: () => ({ kind: "web" }),
}));

describe("semanticLayerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    global.fetch = vi.fn();
    semanticLayerService.resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges stored semantic layer settings with defaults", () => {
    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "ollama",
      semanticLayer: { cacheThreshold: 0.9 },
    } satisfies Partial<AIConfig>);

    expect(getSemanticLayerSettings()).toMatchObject({
      cacheThreshold: 0.9,
      serviceUrl: DEFAULT_SEMANTIC_LAYER_SETTINGS.serviceUrl,
    });
  });

  it("is enabled only for ollama provider", () => {
    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "gemini",
      semanticLayer: { enabled: true },
    } satisfies Partial<AIConfig>);
    expect(isSemanticLayerEnabled()).toBe(false);

    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "ollama",
      semanticLayer: { enabled: true },
    } satisfies Partial<AIConfig>);
    expect(isSemanticLayerEnabled()).toBe(true);
  });

  it("reports degraded status when sidecar is unreachable", async () => {
    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "ollama",
      semanticLayer: { enabled: true, autoStart: false },
    } satisfies Partial<AIConfig>);

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));

    const statuses: SemanticLayerRuntimeStatus[] = [];
    semanticLayerService.subscribeStatus((status) => statuses.push(status));

    await semanticLayerService.initialize();

    expect(semanticLayerService.getStatus()).toBe("degraded");
    expect(statuses).toContain("starting");
    expect(statuses).toContain("degraded");
  });

  it("falls back to null when chat endpoint is unavailable", async () => {
    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "ollama",
      semanticLayer: { enabled: true, autoStart: false },
    } satisfies Partial<AIConfig>);

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));

    await semanticLayerService.initialize();
    const result = await semanticLayerService.chat({ prompt: "hello" });
    expect(result).toBeNull();
  });

  it("returns chat text when sidecar responds", async () => {
    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "ollama",
      semanticLayer: { enabled: true, autoStart: false },
    } satisfies Partial<AIConfig>);

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            text: "Paris",
            cache_hit: true,
            cache_entry_id: "abc",
            model_used: "cache",
            metrics: { total_semantic_ms: 3.2 },
          }),
      });

    await semanticLayerService.initialize();
    expect(semanticLayerService.getStatus()).toBe("running");

    const result = await semanticLayerService.chat({ prompt: "Capital of France?" });
    expect(result).toEqual({
      text: "Paris",
      cacheEntryId: "abc",
      cacheHit: true,
      modelUsed: "cache",
      metrics: { total_semantic_ms: 3.2 },
    });
  });

  it("marks status off when semantic layer is disabled", async () => {
    (storageService.get as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "ollama",
      semanticLayer: { enabled: false },
    } satisfies Partial<AIConfig>);

    await semanticLayerService.initialize();
    expect(semanticLayerService.getStatus()).toBe("off");
    expect(semanticLayerService.isAvailable()).toBe(false);
  });
});
