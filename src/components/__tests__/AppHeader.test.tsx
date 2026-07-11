import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "../AppHeader";

// Mock assets and sub-components

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
  FilterBuilder: () => <div>Filter Builder</div>,
}));

describe("AppHeader", () => {
  const mockOnHeaderExpand = vi.fn();
  const mockOnViewModeChange = vi.fn();
  const mockOnUndo = vi.fn();
  const mockOnToggleCompactView = vi.fn();
  const mockOnFilterOpenChange = vi.fn();
  const mockOnOpenTaskModal = vi.fn();
  const mockOnNaturalLanguageSearch = vi.fn();
  const mockOnSearchQueryChange = vi.fn();
  const mockOnSearchFocusChange = vi.fn();
  const mockOnFiltersChange = vi.fn();
  const mockOnClearFilters = vi.fn();
  const mockOnToggleAssistant = vi.fn();

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
      dateRange: "due" as const,
      startDate: "",
      endDate: "",
    },
    activeFilterGroup: { id: "root", type: "AND", operator: "AND" as const, rules: [] },
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
    onFilterOpenChange: mockOnFilterOpenChange,
    onRequestNotificationPermission: vi.fn(),
    onOpenTaskModal: mockOnOpenTaskModal,
    onSearchQueryChange: mockOnSearchQueryChange,
    onSearchFocusChange: mockOnSearchFocusChange,
    onApplyView: vi.fn(),
    onCreateView: vi.fn(),
    onDeleteView: vi.fn(),
    onFiltersChange: mockOnFiltersChange,
    onAdvancedFilterChange: vi.fn(),
    onClearFilters: mockOnClearFilters,
    sidebarOffset: 0,
    onToggleAssistant: mockOnToggleAssistant,
  };

  it("renders project info correctly when collapsed", () => {
    render(<AppHeader {...baseProps} />);

    expect(screen.getAllByText("Test Project").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 Active Tasks/i).length).toBeGreaterThan(0);
  });

  it("calls onHeaderExpand when the search input gains/loses focus", () => {
    render(<AppHeader {...baseProps} />);

    const searchInput = screen.getByPlaceholderText(/Search tasks/i);
    fireEvent.focus(searchInput);
    expect(mockOnHeaderExpand).toHaveBeenCalledWith(true);
  });

  it("renders the full toolbar in a single row (no expand morph needed)", () => {
    render(<AppHeader {...baseProps} />);

    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search tasks/i)).toBeInTheDocument();
  });

  it("calls onUndo when undo is chosen from the tools menu", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} canUndo={true} />);

    fireEvent.click(screen.getByLabelText("Board tools menu"));
    fireEvent.click(screen.getByRole("button", { name: /Undo/i }));
    expect(mockOnUndo).toHaveBeenCalled();
  });

  it("calls onFilterOpenChange when filter button is clicked", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    fireEvent.click(screen.getByLabelText(/^Filters$/i));
    expect(mockOnFilterOpenChange).toHaveBeenCalledWith(true);
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

  it("calls onNaturalLanguageSearch on Enter when AI search is enabled", () => {
    render(
      <AppHeader
        {...baseProps}
        isHeaderExpanded={true}
        searchQuery="high priority due this week"
        aiSearchEnabled={true}
        onNaturalLanguageSearch={mockOnNaturalLanguageSearch}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Search tasks"), {
      key: "Enter",
      code: "Enter",
    });

    expect(mockOnNaturalLanguageSearch).toHaveBeenCalledWith("high priority due this week");
  });

  it("uses plain search placeholder when AI search is disabled", () => {
    render(<AppHeader {...baseProps} aiSearchEnabled={false} />);

    expect(screen.getByPlaceholderText("Search tasks…")).toBeInTheDocument();
  });

  it("calls onFiltersChange when filter inputs are changed", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} isFilterOpen={true} />);

    const assigneeInput = screen.getByPlaceholderText("Name…");
    fireEvent.change(assigneeInput, { target: { value: "Bob" } });
    expect(mockOnFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ assignee: "Bob" }));

    const tagInput = screen.getByPlaceholderText("Category…");
    fireEvent.change(tagInput, { target: { value: "tag1" } });
    expect(mockOnFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ tags: "tag1" }));
  });

  it("calls onClearFilters when clear all button is clicked", () => {
    render(
      <AppHeader
        {...baseProps}
        isHeaderExpanded={true}
        isFilterOpen={true}
        hasActiveFilters={true}
        activeFilterCount={2}
      />,
    );

    fireEvent.click(screen.getByText("Clear All"));
    expect(mockOnClearFilters).toHaveBeenCalled();
  });

  it("hides AI assistant action when handler is not provided", () => {
    const { onToggleAssistant: _onToggleAssistant, ...propsWithoutAssistant } = baseProps;

    render(<AppHeader {...propsWithoutAssistant} isHeaderExpanded={true} />);

    fireEvent.click(screen.getByLabelText("Board tools menu"));
    expect(screen.queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  it("hides AI prioritize and insights when callbacks are omitted", () => {
    render(<AppHeader {...baseProps} isHeaderExpanded={true} />);

    fireEvent.click(screen.getByLabelText("Board tools menu"));
    expect(screen.queryByRole("button", { name: /AI Prioritize/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /AI Insights/i })).toBeNull();
  });
});
