import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { KeybindingProvider } from "../context/KeybindingContext";
import { ConfirmationProvider } from "../contexts/ConfirmationContext";
import storageService from "../services/storageService";

// We'll use REAL components but mock the heavy services
const { mockInitialize, mockGetAllData, mockGet, mockSet } = vi.hoisted(() => ({
  mockInitialize: vi.fn().mockResolvedValue(undefined),
  mockGetAllData: vi.fn(),
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("../services/storageService", () => ({
  __esModule: true,
  default: {
    initialize: mockInitialize,
    getAllData: mockGetAllData,
    get: mockGet,
    set: mockSet,
  },
  storageService: {
    initialize: mockInitialize,
    getAllData: mockGetAllData,
    get: mockGet,
    set: mockSet,
  }
}));

// Mock icons to speed up rendering and avoid SVG issues
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    Loader2: () => <div data-testid="loader">Loading...</div>,
  };
});

// Mock electronAPI
(global as any).window.electronAPI = {
  isMaximized: vi.fn().mockResolvedValue(false),
  onWindowStateChange: vi.fn().mockReturnValue(() => {}),
  storage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(false),
  },
  workspace: {
    getPaths: vi.fn().mockResolvedValue([]),
    setPaths: vi.fn().mockResolvedValue(undefined),
    selectDirectory: vi.fn().mockResolvedValue(null),
  },
};

describe("App Integration", () => {
  const mockData = {
    projects: [
      { id: "p1", name: "P1", type: "custom", order: 0 },
      { id: "p2", name: "P2", type: "custom", order: 1 }
    ],
    tasks: [],
    activeProjectId: "p1",
    columns: [],
    priorities: [],
    customFields: [],
    projectTypes: [],
    sidebarCollapsed: false,
    grouping: "none",
    version: "2.1.0"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialize.mockResolvedValue(undefined);
    mockGetAllData.mockReturnValue(mockData);
    mockGet.mockImplementation((key: string, def: any) => {
      if (key.includes("activeProjectId")) return "p1";
      if (key.includes("projects")) return mockData.projects;
      if (key.includes("aiConfig")) return { provider: "gemini" };
      return def;
    });
  });

  const renderApp = async () => {
    let result: any;
    await act(async () => {
      result = render(
        <KeybindingProvider>
          <ConfirmationProvider>
            <App />
          </ConfirmationProvider>
        </KeybindingProvider>
      );
    });
    return result;
  };

  it("should render the app shell", async () => {
    await renderApp();
    
    // Wait for splash screen to disappear
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    }, { timeout: 10000 });
    
    // Use findAllByText to handle multiple occurrences
    const logoParts = await screen.findAllByText(/Liqui/i);
    expect(logoParts.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Task/i).length).toBeGreaterThan(0);
  });

  it("handles project switching", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    // In the real sidebar, we might have multiple P2 (pinned + list)
    const p2Links = await screen.findAllByText("P2");
    await act(async () => {
      fireEvent.click(p2Links[0]);
    });
    
    // Use the actual key used in StorageService
    expect(mockSet).toHaveBeenCalledWith("liquitask-active-project", "p2");
  });

  it("opens settings via the sidebar button", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    const settingsBtn = await screen.findByLabelText(/Settings/i);
    await act(async () => {
      fireEvent.click(settingsBtn);
    });

    // Check if settings modal content appears
    await waitFor(() => {
      expect(screen.getByText(/General/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("toggles AI Assistant with Cmd+J", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    // Initially closed
    expect(screen.queryByText("AI Assistant")).toBeNull();

    // Trigger Cmd+J
    await act(async () => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    });

    // Should be open
    await waitFor(() => {
      expect(screen.getByText("AI Assistant")).toBeDefined();
    });

    // Trigger Cmd+J again
    await act(async () => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    });

    // Should be closed
    await waitFor(() => {
      expect(screen.queryByText("AI Assistant")).toBeNull();
    });
  });
});
