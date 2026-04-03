import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "../AppHeader";

// Mock assets and sub-components
vi.mock("../assets/logo.png", () => ({ default: "logo-stub" }));
vi.mock("./ViewSwitcher", () => ({
  ViewSwitcher: () => <div data-testid="view-switcher">View Switcher</div>,
}));
vi.mock("./SearchHistoryDropdown", () => ({
  default: () => <div>Search History</div>,
}));
vi.mock("./SavedViewControls", () => ({
  default: () => <div>Saved Views</div>,
}));
vi.mock("./FilterBuilder", () => ({
  default: () => <div>Filter Builder</div>,
}));

describe("AppHeader", () => {
  const mockOnHeaderExpand = vi.fn();
  const mockOnViewModeChange = vi.fn();
  const mockOnUndo = vi.fn();
  const mockOnToggleCompactView = vi.fn();
  const mockOnToggleFilter = vi.fn();
  const mockOnOpenTaskModal = vi.fn();
  const mockOnOpenCommandPalette = vi.fn();
  const mockOnSearchQueryChange = vi.fn();
  const mockOnSearchFocusChange = vi.fn();
  const mockOnFiltersChange = vi.fn();
  const mockOnClearFilters = vi.fn();

  const baseProps = {
    isHeaderExpanded: false,
    isSidebarCollapsed: false,
    currentView: "project" as const,
    viewMode: "board" as const,
    currentProjectName: "Test Project",
    currentProjectPinned: false,
    currentProjectTaskCount: 5,
    canUndo: false,
    isCompactView: false,
    isFilterOpen: false,
    hasActiveFilters: false,
    activeFilterCount: 0,
    notificationPermission: "default" as const,
    searchQuery: "",
    isSearchFocused: false,
    filters: {
      assignee: "",
      tags: "",
      dateRange: "",
      startDate: "",
      endDate: "",
    } as any,
    activeFilterGroup: { id: "root", type: "AND", rules: [] } as any,
    customFields: [],
    views: [],
    activeViewId: null,
    searchInputRef: { current: null },
    searchHistory: {
      getRecentSearches: () => [],
      getSavedSearches: () => [],
      addToHistory: vi.fn(),
      toggleSaved: vi.fn(),
      removeFromHistory: vi.fn(),
      clearHistory: vi.fn(),
    },
    onHeaderExpand: mockOnHeaderExpand,
    onViewModeChange: mockOnViewModeChange,
    onUndo: mockOnUndo,
    onToggleCompactView: mockOnToggleCompactView,
    onToggleFilter: mockOnToggleFilter,
    onRequestNotificationPermission: vi.fn(),
    onOpenTaskModal: mockOnOpenTaskModal,
    onOpenCommandPalette: mockOnOpenCommandPalette,
    onSearchQueryChange: mockOnSearchQueryChange,
    onSearchFocusChange: mockOnSearchFocusChange,
    onApplyView: vi.fn(),
    onCreateView: vi.fn(),
    onDeleteView: vi.fn(),
    onFiltersChange: mockOnFiltersChange,
    onAdvancedFilterChange: vi.fn(),
    onClearFilters: mockOnClearFilters,
  };

  it("renders project info correctly when collapsed", () => {
    render(<AppHeader {...baseProps} />);

    expect(screen.getAllByText("Test Project").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 Active Tasks/i).length).toBeGreaterThan(0);
  });

  it("calls onHeaderExpand on mouse enter/leave", () => {
    render(<AppHeader {...baseProps} />);

    const header = screen.getByRole("banner");
    fireEvent.mouseEnter(header);
    expect(mockOnHeaderExpand).toHaveBeenCalledWith(true);

    fireEvent.mouseLeave(header);
    expect(mockOnHeaderExpand).toHaveBeenCalledWith(false);
  });

  it("renders expanded content when isHeaderExpanded is true", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search tasks/i)).toBeInTheDocument();
  });

  it("calls onUndo when undo button is clicked", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} canUndo={true} />);

    const undoBtn = screen.getByLabelText(/Undo last action/i);
    fireEvent.click(undoBtn);
    expect(mockOnUndo).toHaveBeenCalled();
  });

  it("calls onToggleFilter when filter button is clicked", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    const filterBtn = screen.getByLabelText(/filters panel/i);
    fireEvent.click(filterBtn);
    expect(mockOnToggleFilter).toHaveBeenCalled();
  });

  it("calls onSearchQueryChange when typing in search input", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    const searchInput = screen.getByPlaceholderText(/Search tasks/i);
    fireEvent.change(searchInput, { target: { value: "test query" } });
    expect(mockOnSearchQueryChange).toHaveBeenCalledWith("test query");
  });

  it("calls onSearchFocusChange and onHeaderExpand on search input focus", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    const searchInput = screen.getByPlaceholderText(/Search tasks/i);
    fireEvent.focus(searchInput);

    expect(mockOnSearchFocusChange).toHaveBeenCalledWith(true);
    expect(mockOnHeaderExpand).toHaveBeenCalledWith(true);
  });

  it("adds to search history on Enter", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} searchQuery="test" />);

    const searchInput = screen.getByPlaceholderText(/Search tasks/i);
    fireEvent.keyDown(searchInput, { key: "Enter", code: "Enter" });

    expect(baseProps.searchHistory.addToHistory).toHaveBeenCalledWith("test");
  });

  it("calls onOpenCommandPalette when command palette button is clicked", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    const cmdBtn = screen.getByTitle(/Command Palette/i);
    fireEvent.click(cmdBtn);
    expect(mockOnOpenCommandPalette).toHaveBeenCalled();
  });

  it("calls onFiltersChange when filter inputs are changed", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} isFilterOpen={true} />);

    const assigneeInput = screen.getByPlaceholderText("Name...");
    fireEvent.change(assigneeInput, { target: { value: "Bob" } });
    expect(mockOnFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ assignee: "Bob" }));

    const tagInput = screen.getByPlaceholderText("Category...");
    fireEvent.change(tagInput, { target: { value: "tag1" } });
    expect(mockOnFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ tags: "tag1" }));
  });

  it("calls onClearFilters when clear all button is clicked", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} isFilterOpen={true} />);

    fireEvent.click(screen.getByText("Clear All"));
    expect(mockOnClearFilters).toHaveBeenCalled();
  });
});
