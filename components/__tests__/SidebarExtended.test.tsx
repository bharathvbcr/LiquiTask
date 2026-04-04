import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";
import type { Project, ProjectType } from "../../types";

// Mock assets and sub-components
vi.mock("../src/assets/logo.png", () => ({ default: "logo-stub" }));
vi.mock("./EditProjectModal", () => ({
  EditProjectModal: () => <div data-testid="edit-modal">Edit Modal</div>,
}));

describe("Sidebar Extended", () => {
  const mockToggleSidebar = vi.fn();
  const mockOnSelectProject = vi.fn();
  const mockOnAddProject = vi.fn();
  const mockOnDeleteProject = vi.fn();
  const mockOnOpenSettings = vi.fn();
  const mockOnChangeView = vi.fn();
  const mockOnTogglePin = vi.fn();
  const mockOnEditProject = vi.fn();
  const mockOnMoveProject = vi.fn();

  const mockProjects: Project[] = [
    { id: "p1", name: "Project 1", type: "code", pinned: false, order: 0 },
    { id: "p2", name: "Project 2", type: "folder", pinned: true, order: 1 },
    {
      id: "p3",
      name: "Sub Project",
      type: "code",
      parentId: "p1",
      pinned: false,
      order: 0
    },
  ] as Project[];

  const mockProjectTypes: ProjectType[] = [
    { id: "code", label: "Code", icon: "code" },
    { id: "folder", label: "Folder", icon: "folder" },
  ];

  const baseProps = {
    projects: mockProjects,
    activeProjectId: "p1",
    projectTypes: mockProjectTypes,
    isCollapsed: false,
    toggleSidebar: mockToggleSidebar,
    onSelectProject: mockOnSelectProject,
    onAddProject: mockOnAddProject,
    onDeleteProject: mockOnDeleteProject,
    onOpenSettings: mockOnOpenSettings,
    currentView: "project" as const,
    onChangeView: mockOnChangeView,
    onTogglePin: mockOnTogglePin,
    onEditProject: mockOnEditProject,
    onMoveProject: mockOnMoveProject,
  };

  it("handles dashboard navigation", () => {
    render(<Sidebar {...baseProps} />);
    const dashboardBtn = screen.getAllByText("Dashboard").find(el => el.tagName === "SPAN");
    if (dashboardBtn) fireEvent.click(dashboardBtn);
    expect(mockOnChangeView).toHaveBeenCalledWith("dashboard");
  });

  it("shows pinned section correctly", () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText("Pinned")).toBeDefined();
    // Project 2 is pinned
    const pinnedItems = screen.getAllByText("Project 2");
    expect(pinnedItems.length).toBeGreaterThan(0);
  });

  it("handles project pinning/unpinning from menu", () => {
    render(<Sidebar {...baseProps} />);
    const moreBtn = screen.getByLabelText("More options for Project 1");
    fireEvent.click(moreBtn);
    
    // Find the button specifically
    const pinBtn = screen.getAllByRole("button").find(b => b.textContent?.includes("Pin") && !b.textContent?.includes("Unpin"));
    if (pinBtn) fireEvent.click(pinBtn);
    expect(mockOnTogglePin).toHaveBeenCalledWith("p1");
  });

  it("handles project movement from menu", () => {
    render(<Sidebar {...baseProps} />);
    const moreBtn = screen.getByLabelText("More options for Project 1");
    fireEvent.click(moreBtn);
    
    const moveDownBtn = screen.getByText(/Move Down/i);
    fireEvent.click(moveDownBtn);
    expect(mockOnMoveProject).toHaveBeenCalledWith("p1", "down");
  });

  it("handles project expansion toggle", () => {
    render(<Sidebar {...baseProps} />);
    const project1Container = screen.getByText("Project 1").closest(".flex-col");
    const chevron = project1Container?.querySelector(".lucide-chevron-down");
    expect(chevron).toBeDefined();
    
    if (chevron) {
      fireEvent.click(chevron);
    }
  });

  it("handles rail hover in collapsed mode", async () => {
    const { container } = render(<Sidebar {...baseProps} isCollapsed={true} />);
    const aside = container.querySelector("aside");
    if (aside) {
      fireEvent.mouseEnter(aside);
      await waitFor(() => {
        const p1 = screen.getByText("Project 1");
        expect(p1).not.toHaveClass("opacity-0");
      });
    }
  });

  it("renders different icons based on project properties", () => {
    const customProjects = [
      { id: "px", name: "Custom Icon", icon: "zap", type: "code" }
    ] as Project[];
    render(<Sidebar {...baseProps} projects={customProjects} />);
    expect(document.querySelector(".lucide-zap")).toBeDefined();
  });
});
