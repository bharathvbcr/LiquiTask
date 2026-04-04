import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { KeybindingProvider } from "../context/KeybindingContext";
import { ConfirmationProvider } from "../contexts/ConfirmationContext";
import storageService from "../services/storageService";

// Define mock functions first
const { mockInitialize, mockGetAllData, mockGet, mockSet } = vi.hoisted(() => ({
  mockInitialize: vi.fn().mockResolvedValue(undefined),
  mockGetAllData: vi.fn(),
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

// Mock services
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

// Mock components - paths MUST match EXACTLY as they appear in App.tsx imports relative to root
// Since App.tsx is in root, it imports from './src/components/AppHeader'
// In this test, we MUST use the same string
vi.mock("./src/components/AppHeader", () => ({
  AppHeader: ({ onOpenTaskModal, onOpenCommandPalette, onOpenSettings }: any) => (
    <div data-testid="app-header-mock">
      <button onClick={onOpenTaskModal}>New Task</button>
      <button onClick={onOpenCommandPalette}>Open Palette</button>
      <button onClick={onOpenSettings}>Open Settings</button>
    </div>
  )
}));

vi.mock("./components/Sidebar", () => ({
  Sidebar: ({ onSelectProject }: any) => (
    <div data-testid="sidebar-mock">
      <button onClick={() => onSelectProject("p2")}>Switch Project</button>
      Sidebar Mock
    </div>
  )
}));

vi.mock("./src/components/ProjectBoard", () => ({
  default: () => <div data-testid="project-board-mock">Project Board</div>
}));

vi.mock("./components/SettingsModal", () => ({
  SettingsModal: ({ isOpen }: { isOpen: boolean }) => 
    isOpen ? <div data-testid="settings-modal-mock">Settings Modal</div> : null
}));

vi.mock("./src/components/CommandPalette", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => 
    isOpen ? <div data-testid="command-palette-mock">Command Palette</div> : null
}));

vi.mock("./components/TaskFormModal", () => ({
  TaskFormModal: () => <div data-testid="task-modal-mock">Task Modal</div>
}));

// Mock runtime
vi.mock("./src/runtime/runtimeEnvironment", () => ({
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
    mockInitialize.mockResolvedValue(undefined);
    mockGetAllData.mockReturnValue(mockData);
    mockGet.mockImplementation((key: string, def: any) => {
      if (key.includes("activeProjectId")) return "p1";
      if (key.includes("projects")) return mockData.projects;
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

  it("should render and load data", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });
    
    expect(await screen.findByTestId("sidebar-mock")).toBeInTheDocument();
  });

  it("handles project switching", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    const switchBtn = await screen.findByText("Switch Project");
    await act(async () => {
      fireEvent.click(switchBtn);
    });
    
    expect(mockSet).toHaveBeenCalledWith(expect.stringContaining("activeProjectId"), "p2");
  });

  it("opens settings modal", async () => {
    await renderApp();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    const settingsBtn = await screen.findByText("Open Settings");
    await act(async () => {
      fireEvent.click(settingsBtn);
    });

    expect(await screen.findByTestId("settings-modal-mock")).toBeInTheDocument();
  });
});
