import {
  Menu,
} from "lucide-react";
import type React from "react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { LiquidButton } from "./LiquidButton";
import type { CustomFieldDefinition, FilterState, SavedView } from "../../types";

import type { SearchHistoryItem } from "../hooks/useSearchHistory";
import type { FilterGroup } from "../types/queryTypes";
import { HeaderFilterPopover } from "./HeaderFilterPopover";
import { HeaderToolsMenu } from "./HeaderToolsMenu";
import { ViewSwitcher } from "./ViewSwitcher";

const SearchHistoryDropdown = lazy(() => import("./SearchHistoryDropdown"));
const SavedViewControls = lazy(() =>
  import("./SavedViewControls").then((module) => ({
    default: module.SavedViewControls,
  })),
);

interface SearchHistoryApi {
  getRecentSearches: () => SearchHistoryItem[];
  getSavedSearches: () => SearchHistoryItem[];
  addToHistory: (query: string) => void;
  toggleSaved: (id: string) => void;
  removeFromHistory: (id: string) => void;
  clearHistory: (keepSaved?: boolean) => void;
}

interface AppHeaderProps {
  isHeaderExpanded: boolean;
  sidebarOffset: number;
  currentView: "project" | "dashboard" | "gantt" | "archive";
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
  views: SavedView[];
  activeViewId: string | null;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchHistory: SearchHistoryApi;
  onHeaderExpand: (expanded: boolean) => void;
  onViewModeChange: (viewMode: "board" | "gantt" | "stats" | "calendar") => void;
  onUndo: () => void;
  onToggleCompactView: () => void;
  onFilterOpenChange: (open: boolean) => void;
  onRequestNotificationPermission: () => void;
  onOpenTaskModal: () => void;
  /** When true, a task card is hovering the New Task drop target. */
  quickAddDropHover?: boolean;
  onSearchQueryChange: (query: string) => void;
  onSearchFocusChange: (focused: boolean) => void;
  onApplyView: (id: string) => void;
  onCreateView: (name?: string) => void;
  onDeleteView: (id: string) => void;
  onFiltersChange: (filters: FilterState) => void;
  onAdvancedFilterChange: (group: FilterGroup) => void;
  onClearFilters: () => void;
  onAiPrioritize?: () => void;
  onAiInsights?: () => void;
  onNaturalLanguageSearch?: (query: string) => void;
  aiSearchEnabled?: boolean;
  onOpenMobileNav?: () => void;
  onToggleAssistant?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
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
  onFilterOpenChange,
  onRequestNotificationPermission,
  onOpenTaskModal,
  quickAddDropHover = false,
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
  aiSearchEnabled = false,
  onOpenMobileNav,
  onToggleAssistant,
}) => {
  // Track the pending blur timeout so re-focusing the search input (e.g. after
  // clicking a history item) can cancel it, preventing a stale timeout from
  // closing the dropdown while the input is actually focused.
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    },
    [],
  );

  const title =
    currentView === "dashboard"
      ? "Executive Dashboard"
      : currentView === "archive"
        ? "Archive"
        : viewMode === "gantt"
          ? "Gantt View"
          : currentProjectName;

  const subtitle =
    currentView === "dashboard"
      ? "Cross-project Overview"
      : currentView === "archive"
        ? "Archived Tasks"
        : viewMode === "gantt"
          ? "Timeline & Dependencies"
          : `Project Board • ${currentProjectTaskCount} Active Tasks${
              currentProjectPinned ? " • Pinned" : ""
            }`;

  return (
    <header
      className="sticky top-0 z-50 mb-4 flex flex-col gap-3 rounded-3xl border border-white/5 px-6 py-3.5 shadow-xl liquid-glass liquid-glass--soft will-change-transform md:mr-[72px]"
      style={{ transform: `translateX(${sidebarOffset}px)` }}
    >
      {/* Single clean row: title · search · view switcher · tools · New Task */}
      <div className="flex items-center gap-3">
        {onOpenMobileNav && (
          <button
            onClick={onOpenMobileNav}
            className="md:hidden flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
        )}

        {/* Title + subtitle — compact, stays on one line */}
        <div className="flex min-w-0 shrink-0 flex-col max-w-[150px] lg:max-w-[220px]">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight text-white text-glow">
              {title}
            </h2>
            {parentProjectName && currentView === "project" && (
              <span className="hidden xl:inline shrink-0 rounded border border-red-500/10 bg-red-500/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-300/70">
                {parentProjectName}
              </span>
            )}
          </div>
          <span className="truncate text-xs font-medium text-slate-400">{subtitle}</span>
        </div>

        {/* Search — grows to fill the middle */}
        <div className="relative min-w-0 flex-1">
          <div
            role="search"
            className="flex h-11 w-full items-center rounded-2xl border border-white/10 bg-black/30 px-4 text-slate-400 shadow-lg transition-all focus-within:border-red-500/50 focus-within:bg-black/40 focus-within:ring-2 focus-within:ring-red-500/20"
            title={
              aiSearchEnabled
                ? "Search tasks or ask in plain language — press Enter for AI filters"
                : "Search tasks and fields — press / to focus"
            }
          >
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Search tasks"
              placeholder={
                aiSearchEnabled
                  ? "Search or ask in plain language…"
                  : "Search tasks…"
              }
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onFocus={() => {
                if (blurTimeoutRef.current) {
                  clearTimeout(blurTimeoutRef.current);
                  blurTimeoutRef.current = null;
                }
                onSearchFocusChange(true);
                onHeaderExpand(true);
              }}
              onBlur={() => {
                blurTimeoutRef.current = setTimeout(() => {
                  onSearchFocusChange(false);
                  onHeaderExpand(false);
                  blurTimeoutRef.current = null;
                }, 200);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  searchHistory.addToHistory(searchQuery.trim());
                  if (aiSearchEnabled && onNaturalLanguageSearch) {
                    onNaturalLanguageSearch(searchQuery.trim());
                  }
                }
              }}
              className="w-full min-w-0 border-none bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none focus:outline-none focus-visible:outline-none"
            />
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

        {/* Right cluster: view switcher · filter · tools menu · saved views · New Task */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ViewSwitcher
            currentView={currentView}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
          />
          <HeaderFilterPopover
            isFilterOpen={isFilterOpen}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
            filters={filters}
            activeFilterGroup={activeFilterGroup}
            customFields={customFields}
            onFilterOpenChange={onFilterOpenChange}
            onFiltersChange={onFiltersChange}
            onAdvancedFilterChange={onAdvancedFilterChange}
            onClearFilters={onClearFilters}
          />
          <HeaderToolsMenu
            canUndo={canUndo}
            isCompactView={isCompactView}
            notificationPermission={notificationPermission}
            onUndo={onUndo}
            onToggleCompactView={onToggleCompactView}
            onRequestNotificationPermission={onRequestNotificationPermission}
            onAiPrioritize={onAiPrioritize}
            onAiInsights={onAiInsights}
            onToggleAssistant={onToggleAssistant}
          />
          <Suspense fallback={null}>
            <SavedViewControls
              views={views}
              activeViewId={activeViewId}
              onApplyView={onApplyView}
              onCreateView={onCreateView}
              onDeleteView={onDeleteView}
            />
          </Suspense>
          <div
            data-quick-add-drop-target
            className={`inline-flex flex-col items-center relative transition-all duration-200 ${
              quickAddDropHover ? "scale-[1.03] -translate-y-0.5" : ""
            }`}
          >
            <div
              className={`rounded-2xl transition-all duration-200 ${
                quickAddDropHover
                  ? "ring-2 ring-red-500/60 shadow-[0_0_24px_rgba(220,30,30,0.25)]"
                  : ""
              }`}
            >
              <LiquidButton
                label={quickAddDropHover ? "Drop to Duplicate" : "New Task"}
                onClick={onOpenTaskModal}
                title="New Task (C) — Quick Add (⌘⇧N) — Drop a card here to duplicate"
              />
            </div>
            {quickAddDropHover && (
              <span className="absolute -bottom-5 text-[9px] uppercase tracking-widest font-bold text-red-400 whitespace-nowrap pointer-events-none">
                Release to Quick Add
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
