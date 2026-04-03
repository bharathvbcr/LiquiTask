import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("../../../src/services/aiService", () => ({
  aiService: {
    testProviderConnection: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    pullModel: vi.fn(),
  },
}));

describe("AiSettings Component", () => {
  const mockAddToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.get as any).mockReturnValue(null);
  });

  it("renders provider selection", () => {
    render(<AiSettings addToast={mockAddToast} />);
    expect(screen.getByText("Google Gemini")).toBeDefined();
    expect(screen.getByText("Ollama")).toBeDefined();
  });

  it("shows Gemini fields by default and saves config", async () => {
    render(<AiSettings addToast={mockAddToast} />);

    const apiKeyInput = screen.getByPlaceholderText("AIzaSy...");
    fireEvent.change(apiKeyInput, { target: { value: "new-api-key" } });

    const saveButton = screen.getByText("Save Configuration");
    fireEvent.click(saveButton);

    expect(storageService.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        provider: "gemini",
        geminiApiKey: "new-api-key",
      }),
    );
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("saved"), "success");
  });

  it("switches to Ollama and shows relevant fields", async () => {
    render(<AiSettings addToast={mockAddToast} />);

    const ollamaButton = screen.getByText("Ollama");
    fireEvent.click(ollamaButton);

    expect(screen.getByPlaceholderText("http://localhost:11434")).toBeDefined();
    expect(screen.getByPlaceholderText("llama3, mistral, etc.")).toBeDefined();
  });

  it("handles connection test success with structured result", async () => {
    (aiService.testProviderConnection as any).mockResolvedValue({
      ok: true,
      stage: "inference",
      message: "Custom success message",
    });
    render(<AiSettings addToast={mockAddToast} />);

    const testButton = screen.getByText("Test Connection");
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith("Custom success message", "success");
    });
  });

  it("handles connection test failure with descriptive message", async () => {
    (aiService.testProviderConnection as any).mockResolvedValue({
      ok: false,
      stage: "service",
      message: "Specific error detail",
    });
    render(<AiSettings addToast={mockAddToast} />);

    const testButton = screen.getByText("Test Connection");
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith("Specific error detail", "error");
    });
  });

  it("shows Ollama model-test explanation", async () => {
    render(<AiSettings addToast={mockAddToast} />);

    fireEvent.click(screen.getByText("Ollama"));

    expect(
      screen.getByText(
        /Test Connection checks the Ollama service, confirms the model is installed, and asks that model for a real response\./i,
      ),
    ).toBeDefined();
  });
});
