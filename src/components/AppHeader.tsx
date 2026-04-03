import {
  Bell,
  Brain,
  Calendar,
  Command,
  Filter,
  Maximize2,
  Menu,
  Minimize2,
  Search,
  Sparkles,
  Tag,
  Undo2,
  User,
} from "lucide-react";
import type React from "react";
import { lazy, Suspense } from "react";
import { LiquidButton } from "../../components/LiquidButton";
import type { CustomFieldDefinition, FilterState } from "../../types";
import logo from "../assets/logo.png";
import type { FilterGroup } from "../types/queryTypes";
import { ViewSwitcher } from "./ViewSwitcher";

const SearchHistoryDropdown = lazy(() => import("./SearchHistoryDropdown"));
const SavedViewControls = lazy(() =>
  import("./SavedViewControls").then((module) => ({
    default: module.SavedViewControls,
  })),
);
const FilterBuilder = lazy(() =>
  import("./FilterBuilder").then((module) => ({
    default: module.FilterBuilder,
  })),
);

interface SearchHistoryApi {
  getRecentSearches: () => string[];
  getSavedSearches: () => string[];
  addToHistory: (query: string) => void;
  toggleSaved: (query: string) => void;
  removeFromHistory: (query: string) => void;
  clearHistory: () => void;
}

interface AppHeaderProps {
  isHeaderExpanded: boolean;
  sidebarOffset: number;
  currentView: "project" | "dashboard" | "gantt";
  viewMode: "board" | "gantt" | "stats" | "calendar";
  currentProjectName: string;
  parentProjectName?: string;
  currentProjectPinned: boolean;
  currentProjectTaskCount: number;
  canUndo: boolean;
  isCompactView: boolean;
  isFilterOpen: boolean;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  notificationPermission: "granted" | "denied" | "default";
  searchQuery: string;
  isSearchFocused: boolean;
  filters: FilterState;
  activeFilterGroup: FilterGroup;
  customFields: CustomFieldDefinition[];
  views: unknown[];
  activeViewId: string | null;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchHistory: SearchHistoryApi;
  onHeaderExpand: (expanded: boolean) => void;
  onViewModeChange: (viewMode: "board" | "gantt" | "stats" | "calendar") => void;
  onUndo: () => void;
  onToggleCompactView: () => void;
  onToggleFilter: () => void;
  onRequestNotificationPermission: () => void;
  onOpenTaskModal: () => void;
  onOpenCommandPalette: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchFocusChange: (focused: boolean) => void;
  onApplyView: (id: string) => void;
  onCreateView: () => void;
  onDeleteView: (id: string) => void;
  onFiltersChange: (filters: FilterState) => void;
  onAdvancedFilterChange: (group: FilterGroup) => void;
  onClearFilters: () => void;
  onAiPrioritize?: () => void;
  onAiInsights?: () => void;
  onNaturalLanguageSearch?: (query: string) => void;
  isNaturalLanguageSearch?: boolean;
  onToggleNaturalLanguageSearch?: () => void;
  onOpenMobileNav?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  isHeaderExpanded,
  sidebarOffset,
  currentView,
  viewMode,
  currentProjectName,
  parentProjectName,
  currentProjectPinned,
  currentProjectTaskCount,
  canUndo,
  isCompactView,
  isFilterOpen,
  hasActiveFilters,
  activeFilterCount,
  notificationPermission,
  searchQuery,
  isSearchFocused,
  filters,
  activeFilterGroup,
  customFields,
  views,
  activeViewId,
  searchInputRef,
  searchHistory,
  onHeaderExpand,
  onViewModeChange,
  onUndo,
  onToggleCompactView,
  onToggleFilter,
  onRequestNotificationPermission,
  onOpenTaskModal,
  onOpenCommandPalette,
  onSearchQueryChange,
  onSearchFocusChange,
  onApplyView,
  onCreateView,
  onDeleteView,
  onFiltersChange,
  onAdvancedFilterChange,
  onClearFilters,
  onAiPrioritize,
  onAiInsights,
  onNaturalLanguageSearch,
  isNaturalLanguageSearch = false,
  onToggleNaturalLanguageSearch,
  onOpenMobileNav,
}) => (
  <header
    className={`fixed top-14 z-50 overflow-hidden rounded-3xl border border-white/5 px-8 shadow-xl liquid-glass will-change-transform md:left-[112px] md:right-6 ${isHeaderExpanded ? "py-6 max-h-[600px]" : "py-3 max-h-16"} transition-[transform,padding,max-height] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)]`}
    style={{ transform: `translateX(${sidebarOffset}px)` }}
    onMouseEnter={() => onHeaderExpand(true)}
    onMouseLeave={() => onHeaderExpand(false)}
  >
    <div
      className={`flex items-center gap-4 transition-opacity duration-300 ${isHeaderExpanded ? "opacity-0 h-0 overflow-hidden" : "opacity-100 h-16"}`}
    >
      {onOpenMobileNav && (
        <button
          onClick={onOpenMobileNav}
          className="md:hidden p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>
      )}
      <img
        src={logo}
        alt="LiquiTask"
        className="w-6 h-6 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] shrink-0"
      />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white tracking-tight drop-shadow-md text-glow truncate">
            {currentView === "dashboard"
              ? "Executive Dashboard"
              : viewMode === "gantt"
                ? "Gantt View"
                : currentProjectName}
          </h2>
          {parentProjectName && currentView === "project" && (
            <span className="text-[10px] text-slate-500 border border-white/5 bg-white/5 px-1.5 rounded uppercase tracking-wider">
              {parentProjectName}
            </span>
          )}
        </div>
        {currentView === "project" && viewMode !== "gantt" && (
          <span className="text-[10px] text-slate-400 font-medium truncate">
            {currentProjectTaskCount} Active Tasks {currentProjectPinned && "• Pinned"}
          </span>
        )}
      </div>
      <div className="shrink-0 ml-auto flex items-center gap-2">
        <ViewSwitcher
          currentView={currentView}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          hideBoardAndGantt={true}
        />
      </div>
    </div>

    <div
      className={`flex flex-col gap-5 transition-opacity duration-300 ${isHeaderExpanded ? "opacity-100" : "opacity-0 h-0 overflow-hidden"}`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <img
            src={logo}
            alt="LiquiTask"
            className="w-8 h-8 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] shrink-0"
            title="LiquiTask - Task Management Dashboard"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-bold text-white tracking-tight drop-shadow-md text-glow truncate">
              {currentView === "dashboard"
                ? "Executive Dashboard"
                : viewMode === "gantt"
                  ? "Gantt View"
                  : currentProjectName}
            </h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {parentProjectName && currentView === "project" && (
                <span className="text-xs text-red-300/70 px-2 py-0.5 rounded-md border border-red-500/10 bg-red-500/5 shrink-0">
                  {parentProjectName} /
                </span>
              )}
              <p className="text-slate-400 text-sm font-medium">
                {currentView === "dashboard"
                  ? "Cross-project Overview"
                  : viewMode === "gantt"
                    ? "Timeline & Dependencies"
                    : `Project Board • ${currentProjectTaskCount} Active Tasks`}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <ViewSwitcher
              currentView={currentView}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-2.5 rounded-xl transition-all relative group ${canUndo ? "text-slate-400 hover:text-white hover:bg-white/10" : "text-slate-600 opacity-40 cursor-not-allowed"}`}
            title={
              canUndo
                ? "Undo last action (Ctrl+Z) - Revert task changes, deletions, or moves"
                : "Undo (Ctrl+Z) - No actions to undo"
            }
            aria-label="Undo last action"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={onToggleCompactView}
            className={`p-2.5 rounded-xl transition-all relative group ${isCompactView ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-slate-400 hover:text-white hover:bg-white/10"}`}
            title={
              isCompactView
                ? "Expand View - Show full task details"
                : "Compact View - Show condensed task cards"
            }
            aria-label={isCompactView ? "Expand view" : "Compact view"}
          >
            {isCompactView ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
          </button>
          {onAiPrioritize && (
            <button
              onClick={onAiPrioritize}
              className="p-2.5 rounded-xl transition-all text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 relative group"
              title="AI Prioritize - Let AI analyze and suggest optimal task priorities"
              aria-label="AI Prioritize tasks"
            >
              <Sparkles size={18} />
            </button>
          )}
          {onAiInsights && (
            <button
              onClick={onAiInsights}
              className="p-2.5 rounded-xl transition-all text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 relative group"
              title="AI Insights - View AI-generated analysis and recommendations"
              aria-label="AI Insights"
            >
              <Brain size={18} />
            </button>
          )}
          <button
            onClick={onToggleFilter}
            className={`p-2.5 rounded-xl transition-all relative group ${isFilterOpen ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-slate-400 hover:text-white hover:bg-white/10"}`}
            title={
              isFilterOpen
                ? `Close Filters${hasActiveFilters ? ` - ${activeFilterCount} active filter${activeFilterCount !== 1 ? "s" : ""}` : " - No filters applied"}`
                : `Filters${hasActiveFilters ? ` - ${activeFilterCount} active filter${activeFilterCount !== 1 ? "s" : ""}` : " - No filters applied"}`
            }
            aria-label={isFilterOpen ? "Close filters panel" : "Open filters panel"}
            {...(isFilterOpen ? { "aria-expanded": "true" } : { "aria-expanded": "false" })}
          >
            <Filter size={18} />
          </button>
          <button
            className="relative p-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
            aria-label="Notifications"
            title={
              notificationPermission === "granted"
                ? "Notifications - Desktop alerts enabled for task reminders"
                : notificationPermission === "denied"
                  ? "Notifications - Permission denied, check browser settings"
                  : "Notifications - Click to enable desktop alerts for task reminders"
            }
            onClick={onRequestNotificationPermission}
          >
            <Bell size={18} />
          </button>
          <LiquidButton
            label="New Task"
            onClick={onOpenTaskModal}
            title="New Task (C) - Create a new task quickly"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div
          className={`relative flex-shrink-0 transition-all duration-300 ease-in-out ${isSearchFocused || searchQuery.length > 0 ? "min-w-[280px] max-w-md" : "w-48"}`}
        >
          <div
            className={`flex items-center gap-3 bg-black/30 border px-4 py-3 rounded-2xl text-slate-400 focus-within:ring-2 focus-within:bg-black/40 transition-all shadow-lg w-full ${isNaturalLanguageSearch ? "border-purple-500/50 focus-within:border-purple-500/50 focus-within:ring-purple-500/20" : "border-white/10 focus-within:border-red-500/50 focus-within:ring-red-500/20"}`}
            title={
              isNaturalLanguageSearch
                ? 'Natural Language Search (AI-powered) - Type queries like "high priority tasks due this week"'
                : "Search tasks and fields - Press / to focus, Enter to search"
            }
          >
            {isNaturalLanguageSearch ? (
              <Sparkles size={18} className="text-purple-400 shrink-0" />
            ) : (
              <Search size={18} className="text-slate-500 shrink-0" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              placeholder={
                isNaturalLanguageSearch
                  ? 'Ask AI: "high priority tasks due this week"...'
                  : "Search tasks... (Press / to focus)"
              }
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onFocus={() => {
                onSearchFocusChange(true);
                onHeaderExpand(true);
              }}
              onBlur={() => setTimeout(() => onSearchFocusChange(false), 200)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  searchHistory.addToHistory(searchQuery.trim());
                  if (isNaturalLanguageSearch && onNaturalLanguageSearch) {
                    onNaturalLanguageSearch(searchQuery.trim());
                  }
                }
              }}
              className="bg-transparent border-none outline-none focus:outline-none focus-visible:outline-none text-sm w-full placeholder-slate-500 text-slate-200"
            />
            {onToggleNaturalLanguageSearch && (
              <button
                onClick={onToggleNaturalLanguageSearch}
                className={`p-1.5 rounded-lg transition-all shrink-0 ${isNaturalLanguageSearch ? "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10" : "text-slate-500 hover:text-purple-400 hover:bg-purple-500/10"}`}
                title={
                  isNaturalLanguageSearch
                    ? "Switch to standard search"
                    : "AI Natural Language Search - Type queries in plain English"
                }
              >
                <Sparkles size={14} />
              </button>
            )}
            <button
              onClick={onOpenCommandPalette}
              className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all shrink-0"
              title="Command Palette (Cmd+K) - Quick actions, navigation, and shortcuts"
            >
              <Command size={14} />
            </button>
          </div>
          {isSearchFocused && (
            <Suspense fallback={null}>
              <SearchHistoryDropdown
                isOpen={isSearchFocused}
                recentSearches={searchHistory.getRecentSearches()}
                savedSearches={searchHistory.getSavedSearches()}
                onSelectSearch={(query) => {
                  onSearchQueryChange(query);
                  searchInputRef.current?.focus();
                }}
                onToggleSaved={searchHistory.toggleSaved}
                onRemove={searchHistory.removeFromHistory}
                onClearHistory={searchHistory.clearHistory}
              />
            </Suspense>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Suspense fallback={null}>
            <SavedViewControls
              views={views}
              activeViewId={activeViewId}
              onApplyView={onApplyView}
              onCreateView={onCreateView}
              onDeleteView={onDeleteView}
            />
          </Suspense>
        </div>
      </div>

      <div
        className={`pt-4 border-t border-white/5 overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] ${isFilterOpen ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <User size={10} /> Assignee
            </label>
            <input
              type="text"
              value={filters.assignee}
              onChange={(e) => onFiltersChange({ ...filters, assignee: e.target.value })}
              className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 w-32 focus:border-red-500/50 outline-none"
              placeholder="Name..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <Tag size={10} /> Tag
            </label>
            <input
              type="text"
              value={filters.tags}
              onChange={(e) => onFiltersChange({ ...filters, tags: e.target.value })}
              className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 w-32 focus:border-red-500/50 outline-none"
              placeholder="Category..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <Calendar size={10} /> Date Range
            </label>
            <div className="flex items-center gap-2">
              <select
                value={filters.dateRange || ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    dateRange: e.target.value as FilterState["dateRange"],
                  })
                }
                className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:border-red-500/50 outline-none"
                aria-label="Date range filter type"
                title="Date range filter type"
              >
                <option value="">None</option>
                <option value="due">Due Date</option>
                <option value="created">Created Date</option>
              </select>
              {filters.dateRange && (
                <>
                  <label className="sr-only">Start date</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })}
                    className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]"
                    aria-label="Start date"
                    title="Start date"
                  />
                  <span className="text-slate-500">-</span>
                  <label className="sr-only">End date</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })}
                    className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]"
                    aria-label="End date"
                    title="End date"
                  />
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClearFilters}
            className="ml-auto text-xs text-red-400 hover:text-white underline"
          >
            Clear All
          </button>
        </div>

        <div className="pt-4 border-t border-white/5">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">
            Advanced Query
          </h4>
          {isFilterOpen && (
            <Suspense fallback={null}>
              <FilterBuilder
                rootGroup={activeFilterGroup}
                onChange={onAdvancedFilterChange}
                customFields={customFields}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  </header>
);
