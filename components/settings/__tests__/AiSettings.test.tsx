import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "../../../src/services/aiService";
import storageService from "../../../src/services/storageService";
import { AiSettings } from "../AiSettings";

// Mock services
vi.mock("../../../src/services/storageService", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../../../src/services/aiService", () => ({
  aiService: {
    testProviderConnection: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    pullModel: vi.fn(),
    getAutoOrganizeConfig: vi.fn().mockReturnValue({
      enabled: false,
      operations: { clustering: true }
    }),
    saveAutoOrganizeConfig: vi.fn(),
  },
}));

describe("AiSettings Component", () => {
  const mockAddToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.get as Mock).mockReturnValue(null);
  });

  it("renders provider selection", () => {
    render(<AiSettings addToast={mockAddToast} />);
    expect(screen.getByText("Google Gemini")).toBeDefined();
    expect(screen.getByText("Ollama")).toBeDefined();
  });

  it("shows Gemini fields by default and saves config", async () => {
    render(<AiSettings addToast={mockAddToast} />);

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
    render(<AiSettings addToast={mockAddToast} />);
    
    // Find ALL switches and find the one with the right label
    const switches = screen.getAllByRole("switch");
    const masterToggle = switches.find(s => s.getAttribute("aria-label") === "Toggle Auto-Organize");
    
    if (!masterToggle) throw new Error("Master toggle not found");

    await act(async () => {
      fireEvent.click(masterToggle);
    });
    
    // Check if sub-toggles appear
    expect(await screen.findByText("Clustering")).toBeDefined();
    
    const clusteringToggle = screen.getAllByRole("switch").find(s => s.getAttribute("aria-label")?.includes("Clustering"));
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
          enabled: true
        })
      })
    );
  });

  it("calls modal opening functions from quick actions", async () => {
    const mockOpenMerge = vi.fn();
    const mockOpenReorganize = vi.fn();
    
    render(
      <AiSettings 
        addToast={mockAddToast} 
        onOpenMergeModal={mockOpenMerge}
        onOpenReorganizeModal={mockOpenReorganize}
      />
    );
    
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
});
