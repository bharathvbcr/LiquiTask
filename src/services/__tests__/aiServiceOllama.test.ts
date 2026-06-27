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
      json: () =>
        Promise.resolve({
          message: {
            content: JSON.stringify([
              {
                title: "Ollama Task",
                summary: "S",
                priority: "medium",
                tags: [],
                timeEstimate: 10,
              },
            ]),
          },
        }),
    });

    const tasks = await aiService.extractTasksFromText("test", mockContext);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Ollama Task");
  });

  it("lists Ollama models", async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [{ name: "llama3:latest" }, { name: "mistral:latest" }],
        }),
    });

    const models = await aiService.listModels();
    expect(models).toEqual(["llama3:latest", "mistral:latest"]);
  });

  it("pulls an Ollama model", async () => {
    const onProgress = vi.fn();

    // Create a mock reader
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            JSON.stringify({ status: "downloading", completed: 50, total: 100 }) + "\n",
          ),
        })
        .mockResolvedValueOnce({ done: true }),
    };

    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    });

    await aiService.pullModel("llama3", onProgress);
    expect(onProgress).toHaveBeenCalledWith("downloading", 50);
    // Always finishes at 100% on a clean stream end.
    expect(onProgress).toHaveBeenLastCalledWith("success", 100);
  });

  it("aggregates progress across multiple pull layers", async () => {
    const onProgress = vi.fn();
    const chunk = (obj: Record<string, unknown>) =>
      new TextEncoder().encode(JSON.stringify(obj) + "\n");

    const mockReader = {
      read: vi
        .fn()
        // Two layers reported together: 50/100 + 0/100 => 25% overall.
        .mockResolvedValueOnce({
          done: false,
          value: chunk({ status: "downloading", digest: "a", completed: 50, total: 100 }),
        })
        .mockResolvedValueOnce({
          done: false,
          value: chunk({ status: "downloading", digest: "b", completed: 0, total: 100 }),
        })
        .mockResolvedValueOnce({ done: true }),
    };
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    });

    await aiService.pullModel("llama3", onProgress);
    expect(onProgress).toHaveBeenCalledWith("downloading", 25);
  });

  it("propagates a mid-stream Ollama error instead of swallowing it", async () => {
    const onProgress = vi.fn();
    const mockReader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(JSON.stringify({ error: "file does not exist" }) + "\n"),
      }),
    };
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    });

    await expect(aiService.pullModel("bogus", onProgress)).rejects.toThrow("file does not exist");
  });

  it("surfaces an Ollama error body when the pull request fails", async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(JSON.stringify({ error: "model not found" })),
    });

    await expect(aiService.pullModel("ghost")).rejects.toThrow("model not found");
  });

  it("handles Ollama connection test failure", async () => {
    (global.fetch as Mock).mockRejectedValue(new Error("Ollama connection refused"));

    const result = await aiService.testProviderConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ollama");
  });
});
