import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, AIContext } from "../../../types";
import { aiService } from "../aiService";
import storageService from "../storageService";

// Mock storageService
vi.mock("../storageService", () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

describe("AiService Ollama", () => {
  const mockContext: AIContext = {
    activeProjectId: "p1",
    projects: [{ id: "p1", name: "P1", type: "default" }],
    priorities: [],
  };

  const config: AIConfig = {
    provider: "ollama",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "llama3",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    (storageService.get as Mock).mockReturnValue(config);
  });

  it("extracts tasks using Ollama", async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        message: {
          content: JSON.stringify([{ title: "Ollama Task", summary: "S", priority: "medium", tags: [], timeEstimate: 10 }])
        }
      }),
    });

    const tasks = await aiService.extractTasksFromText("test", mockContext);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Ollama Task");
  });

  it("lists Ollama models", async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: "llama3:latest" },
          { name: "mistral:latest" }
        ]
      }),
    });

    const models = await aiService.listModels();
    expect(models).toEqual(["llama3:latest", "mistral:latest"]);
  });

  it("pulls an Ollama model", async () => {
    const onProgress = vi.fn();
    
    // Create a mock reader
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(JSON.stringify({ status: "downloading", completed: 50, total: 100 }) + "\n")
        })
        .mockResolvedValueOnce({ done: true })
    };

    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => mockReader
      },
    });

    await aiService.pullModel("llama3", onProgress);
    expect(onProgress).toHaveBeenCalledWith("downloading", 50);
  });

  it("handles Ollama connection test failure", async () => {
    (global.fetch as Mock).mockRejectedValue(new Error("Ollama connection refused"));

    const result = await aiService.testProviderConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ollama");
  });
});
