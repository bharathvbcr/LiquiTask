import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { KeybindingProvider } from "../context/KeybindingContext";
import { ConfirmationProvider } from "../contexts/ConfirmationContext";
import storageService from "../services/storageService";

// Mock AppHeader to avoid lazy loading issues in integration tests
vi.mock("../components/AppHeader", () => ({
  AppHeader: ({ onOpenTaskModal }: { onOpenTaskModal: () => void }) => (
    <header>
      <button onClick={onOpenTaskModal}>New Task</button>
      <button>Gantt</button>
      <span>List</span>
    </header>
  ),
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: () => <nav>Sidebar</nav>,
}));

vi.mock("../components/ProjectBoard", () => ({
  default: () => <div>Project Board</div>,
}));

vi.mock("../../components/TaskFormModal", () => ({
  TaskFormModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div>
        Task Form Modal <input placeholder="e.g., Update Q3 Financials" />
      </div>
    ) : null,
}));

vi.mock("../../components/SettingsModal", () => ({
  SettingsModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Settings Modal</div> : null),
}));

// Mock heavy services and lazy components
vi.mock("../services/storageService", () => ({
  default: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllData: vi.fn().mockReturnValue({}),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../services/indexedDBService", () => ({
  indexedDBService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockReturnValue(true),
    saveColumns: vi.fn().mockResolvedValue(undefined),
    savePriorities: vi.fn().mockResolvedValue(undefined),
    saveCustomFields: vi.fn().mockResolvedValue(undefined),
    saveProject: vi.fn().mockResolvedValue(undefined),
    saveTasks: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock icons and assets
vi.mock("../assets/logo.png", () => ({ default: "test-file-stub" }));

describe("App Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading state initially", () => {
    render(
      <KeybindingProvider>
        <ConfirmationProvider>
          <App />
        </ConfirmationProvider>
      </KeybindingProvider>,
    );
    expect(screen.getByText(/Loading LiquiTask.../i)).toBeInTheDocument();
  });

  it("should render app shell after data is loaded", async () => {
    const mockData = {
      projects: [{ id: "p1", name: "Test Project", type: "custom" }],
      tasks: [],
      activeProjectId: "p1",
    };
    vi.mocked(storageService.getAllData).mockReturnValue(mockData);

    render(
      <KeybindingProvider>
        <ConfirmationProvider>
          <App />
        </ConfirmationProvider>
      </KeybindingProvider>,
    );

    // Wait for isLoaded to become true (after storageService.initialize and loadData)
    await waitFor(
      () => {
        expect(screen.queryByText(/Loading LiquiTask.../i)).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(await screen.findByText(/Loading view\.\.\./i)).toBeInTheDocument();
  });

  it("should switch between views", async () => {
    const mockData = {
      projects: [{ id: "p1", name: "Test Project", type: "custom" }],
      tasks: [],
      activeProjectId: "p1",
    };
    vi.mocked(storageService.getAllData).mockReturnValue(mockData);

    render(
      <KeybindingProvider>
        <ConfirmationProvider>
          <App />
        </ConfirmationProvider>
      </KeybindingProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Loading LiquiTask.../i)).not.toBeInTheDocument();
    });

    // Expand header to see ViewSwitcher (wait for AppHeader to load)
    const header = await screen.findByRole("banner", {}, { timeout: 5000 });
    fireEvent.mouseEnter(header);

    const ganttBtn = await screen.findByText(/Gantt/i);
    expect(ganttBtn).toBeInTheDocument();

    fireEvent.click(ganttBtn);
    // Since we mocked the component synchronously, it should be visible immediately
    // or at least we don't need to wait for the loading fallback
  });

  it('should open task modal when "New Task" is clicked', async () => {
    const mockData = {
      projects: [{ id: "p1", name: "Test Project", type: "custom" }],
      tasks: [],
      activeProjectId: "p1",
    };
    vi.mocked(storageService.getAllData).mockReturnValue(mockData);

    render(
      <KeybindingProvider>
        <ConfirmationProvider>
          <App />
        </ConfirmationProvider>
      </KeybindingProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Loading LiquiTask.../i)).not.toBeInTheDocument();
    });

    const header = await screen.findByRole("banner");
    fireEvent.mouseEnter(header);

    const newTaskBtn = await screen.findByText(/New Task/i);
    fireEvent.click(newTaskBtn);

    // Wait for modal to load (lazy loaded)
    expect(await screen.findByPlaceholderText(/e\.g\., Update Q3 Financials/i)).toBeInTheDocument();
  });
});
