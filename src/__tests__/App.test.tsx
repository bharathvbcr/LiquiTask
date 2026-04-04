import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { KeybindingProvider } from "../context/KeybindingContext";
import { ConfirmationProvider } from "../contexts/ConfirmationContext";
import storageService from "../services/storageService";

// Mock services first - must be top level
vi.mock("../src/services/storageService", () => ({
  __esModule: true,
  default: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllData: vi.fn().mockReturnValue({ projects: [], tasks: [], activeProjectId: "p1" }),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock components
vi.mock("../src/components/AppHeader", () => ({
  AppHeader: ({ onOpenTaskModal, onOpenCommandPalette, onOpenSettings }: any) => (
    <header role="banner">
      <button onClick={onOpenTaskModal}>New Task</button>
      <button onClick={onOpenCommandPalette}>Open Palette</button>
      <button onClick={onOpenSettings}>Open Settings</button>
    </header>
  )
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: ({ onSelectProject }: any) => (
    <nav data-testid="sidebar">
      <button onClick={() => onSelectProject("p2")}>Switch Project</button>
      Sidebar Mock
    </nav>
  )
}));

vi.mock("../components/ProjectBoard", () => ({
  default: () => <div data-testid="project-board">Project Board</div>
}));

vi.mock("../components/SettingsModal", () => ({
  SettingsModal: ({ isOpen }: { isOpen: boolean }) => 
    isOpen ? <div data-testid="settings-modal">Settings Modal</div> : null
}));

vi.mock("../src/components/CommandPalette", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => 
    isOpen ? <div data-testid="command-palette">Command Palette</div> : null
}));

vi.mock("../src/components/TaskFormModal", () => ({
  TaskFormModal: () => <div data-testid="task-modal">Task Modal</div>
}));

// Mock runtime
vi.mock("../src/runtime/runtimeEnvironment", () => ({
  getRuntimeKind: () => "web",
  getRuntimeState: () => ({ kind: "web", hasCustomWindowControls: false }),
  getRuntimeWindowControls: () => null,
  getElectronAPI: () => null,
  getNativeStorageApi: () => null,
  getPlatform: () => "web",
}));

describe("App Integration", () => {
  const mockData = {
    projects: [
      { id: "p1", name: "P1", type: "custom" },
      { id: "p2", name: "P2", type: "custom" }
    ],
    tasks: [],
    activeProjectId: "p1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(storageService, "getAllData").mockReturnValue(mockData as any);
    vi.spyOn(storageService, "get").mockImplementation(((key: string, def: any) => {
      if (key.includes("activeProjectId")) return "p1";
      if (key.includes("projects")) return mockData.projects;
      return def;
    }) as any);
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

  it("should render and load data", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });
    
    expect(await screen.findByTestId("sidebar")).toBeInTheDocument();
  });

  it("handles project switching", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    const switchBtn = await screen.findByText("Switch Project");
    await act(async () => {
      fireEvent.click(switchBtn);
    });
    
    expect(storageService.set).toHaveBeenCalledWith(expect.stringContaining("activeProjectId"), "p2");
  });

  it("opens settings modal", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    const settingsBtn = await screen.findByText("Open Settings");
    await act(async () => {
      fireEvent.click(settingsBtn);
    });

    expect(await screen.findByTestId("settings-modal")).toBeInTheDocument();
  });
});
