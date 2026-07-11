import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "../../../services/aiService";
import storageService from "../../../services/storageService";
import { AiSettings } from "../AiSettings";

// Mock services
vi.mock("../../../services/storageService", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../../../services/nativeBridge", () => ({
  nativeClaudeHealth: vi.fn().mockResolvedValue({ ok: false }),
  nativeClaudeModels: vi.fn().mockResolvedValue({ models: [], source: "static" }),
}));

vi.mock("../../../services/aiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/aiService")>();
  return {
    ...actual,
    aiService: {
      testProviderConnection: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      pullModel: vi.fn(),
      getAutoOrganizeConfig: vi.fn().mockReturnValue({
        enabled: false,
        operations: { clustering: true },
      }),
      saveAutoOrganizeConfig: vi.fn(),
    },
  };
});

// Mock electronAPI
(global as any).window.electronAPI = {
  workspace: {
    getPaths: vi.fn().mockResolvedValue(["/test/path"]),
    setPaths: vi.fn().mockResolvedValue(undefined),
  },
};

describe("AiSettings Component", () => {
  const mockAddToast = vi.fn();

  const renderAiSettings = async (props: Partial<React.ComponentProps<typeof AiSettings>> = {}) => {
    await act(async () => {
      render(<AiSettings addToast={mockAddToast} {...props} />);
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.get as Mock).mockReturnValue(null);
  });

  it("renders provider selection", async () => {
    await renderAiSettings();
    expect(screen.getByText("Google Gemini")).toBeDefined();
    expect(screen.getByText("Ollama")).toBeDefined();
    expect(screen.getByText("Claude Code")).toBeDefined();
  });

  it("shows Gemini fields by default and saves config", async () => {
    await renderAiSettings();

    const apiKeyInput = screen.getByPlaceholderText("AIzaSy...");
    await act(async () => {
      fireEvent.change(apiKeyInput, { target: { value: "new-api-key" } });
    });

    const saveButton = screen.getByText("Save Configuration");
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(storageService.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        provider: "gemini",
        geminiApiKey: "new-api-key",
      }),
    );
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("saved"), "success");
  });

  it("handles Auto-Organize toggles", async () => {
    await renderAiSettings();

    // Find ALL switches and find the one with the right label
    const switches = screen.getAllByRole("switch");
    const masterToggle = switches.find(
      (s) => s.getAttribute("aria-label") === "Toggle Auto-Organize",
    );

    if (!masterToggle) throw new Error("Master toggle not found");

    await act(async () => {
      fireEvent.click(masterToggle);
    });

    // Check if sub-toggles appear
    expect(await screen.findByText("Clustering")).toBeDefined();

    const clusteringToggle = screen
      .getAllByRole("switch")
      .find((s) => s.getAttribute("aria-label")?.includes("Clustering"));
    if (clusteringToggle) {
      await act(async () => {
        fireEvent.click(clusteringToggle);
      });
    }

    const saveButton = screen.getByText("Save Configuration");
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(storageService.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        autoOrganize: expect.objectContaining({
          enabled: true,
        }),
      }),
    );
  });

  it("calls modal opening functions from quick actions", async () => {
    const mockOpenMerge = vi.fn();
    const mockOpenReorganize = vi.fn();

    await renderAiSettings({
      onOpenMergeModal: mockOpenMerge,
      onOpenReorganizeModal: mockOpenReorganize,
    });

    const mergeBtn = screen.getByText("Merge");
    await act(async () => {
      fireEvent.click(mergeBtn);
    });
    expect(mockOpenMerge).toHaveBeenCalled();

    const reorganizeBtn = screen.getByText("Reorganize");
    await act(async () => {
      fireEvent.click(reorganizeBtn);
    });
    expect(mockOpenReorganize).toHaveBeenCalled();
  });

  it("persists provider 'ollama' when Ollama is selected so model listing does not silently route to Gemini", async () => {
    // Regression guard. The stored config defaults to provider "gemini". The
    // bug: fetchModels re-persisted that config overriding only ollamaBaseUrl,
    // leaving provider "gemini". aiService.getProvider() then built a
    // GeminiProvider (which has no listModels), so listModels() silently
    // returned [] and the model dropdown never populated — the empty
    // "Make sure Ollama is running…" state — with no error surfaced.
    (aiService.listModels as Mock).mockResolvedValue(["gemma4:31b-mlx", "llama3"]);

    await renderAiSettings();

    await act(async () => {
      fireEvent.click(screen.getByText("Ollama"));
    });

    // The config persisted for the model fetch must carry provider "ollama",
    // otherwise model listing routes to the wrong provider and returns [].
    await waitFor(() => {
      expect(storageService.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          provider: "ollama",
          ollamaBaseUrl: expect.stringContaining("11434"),
        }),
      );
    });

    // And the fetched models populate the dropdown instead of the empty state.
    expect(await screen.findByRole("option", { name: "gemma4:31b-mlx" })).toBeDefined();
    expect(screen.queryByText(/Make sure Ollama is running/)).toBeNull();
  });

  it("loads and displays workspace paths", async () => {
    await renderAiSettings();

    await waitFor(() => {
      expect(screen.getByText("/test/path")).toBeDefined();
      expect(screen.getByText("Add Workspace Folder")).toBeDefined();
    });
  });

  it("shows Claude Code model picker with friendly labels when selected", async () => {
    await renderAiSettings();

    await act(async () => {
      fireEvent.click(screen.getByText("Claude Code"));
    });

    expect(await screen.findByRole("option", { name: "Claude Sonnet 4.6" })).toBeDefined();
    expect(screen.getByText(/Same runtime as agent teammates/)).toBeDefined();
  });
});
