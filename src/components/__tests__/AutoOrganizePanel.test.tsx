import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoOrganizePanel } from "../AutoOrganizePanel";
import { aiService } from "../../services/aiService";
import { autoOrganizeService } from "../../services/autoOrganizeService";

// Mock services
vi.mock("../../services/aiService", () => ({
  aiService: {
    clusterTasks: vi.fn().mockResolvedValue([]),
    getOrganizeHistory: vi.fn().mockReturnValue([]),
    getAutoOrganizeConfig: vi.fn().mockReturnValue({
      enabled: false,
      autoApplyThreshold: 0.85,
      suggestThreshold: 0.7,
      operations: {
        clustering: true,
        deduplication: true,
        autoTagging: true,
        hierarchyDetection: true,
        projectAssignment: true,
        tagConsolidation: true,
      }
    }),
    saveAutoOrganizeConfig: vi.fn(),
    saveOrganizeHistory: vi.fn(),
  },
}));

vi.mock("../../services/autoOrganizeService", () => ({
  autoOrganizeService: {
    runAutoOrganize: vi.fn().mockResolvedValue({
      id: "run-1",
      timestamp: new Date(),
      duration: 1000,
      tasksAnalyzed: 2,
      changes: [
        { id: "c1", type: "tag", taskId: "1", before: {}, after: { tags: ["ai"] }, confidence: 0.9, reasoning: "R", status: "auto-applied" }
      ],
      autoApplied: 1,
      pendingReview: 0,
    }),
  },
}));

vi.mock("../../services/storageService", () => ({
  default: {
    get: vi.fn().mockReturnValue({}),
  },
}));

describe("AutoOrganizePanel", () => {
  const mockTasks = [
    { id: "1", title: "Task 1", tags: [] },
    { id: "2", title: "Task 2", tags: [] },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders configuration and history", () => {
    render(
      <AutoOrganizePanel
        isOpen={true}
        onClose={vi.fn()}
        allTasks={mockTasks}
        onUpdateTask={vi.fn()}
        onArchiveTask={vi.fn()}
        onMoveTask={vi.fn()}
        addToast={vi.fn()}
      />
    );

    expect(screen.getByText("AI Auto-Organize")).toBeInTheDocument();
    expect(screen.getByText("Cluster")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Auto-Organize/i })).toBeInTheDocument();
  });

  it("handles organization process", async () => {
    render(
      <AutoOrganizePanel
        isOpen={true}
        onClose={vi.fn()}
        allTasks={mockTasks}
        onUpdateTask={vi.fn()}
        onArchiveTask={vi.fn()}
        onMoveTask={vi.fn()}
        addToast={vi.fn()}
      />
    );

    const startBtn = screen.getByRole("button", { name: /Run Auto-Organize/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/auto applied/i)).toBeInTheDocument();
    });
    
    expect(autoOrganizeService.runAutoOrganize).toHaveBeenCalled();
  });
});
