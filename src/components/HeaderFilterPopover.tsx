import { Calendar, Filter, Tag, User, X } from "lucide-react";
import type React from "react";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomFieldDefinition, FilterState } from "../../types";
import type { FilterGroup } from "../types/queryTypes";
import { IconButton } from "./common/IconButton";
import { Tooltip } from "./Tooltip";

const FilterBuilder = lazy(() =>
  import("./FilterBuilder").then((module) => ({
    default: module.FilterBuilder,
  })),
);

interface HeaderFilterPopoverProps {
  isFilterOpen: boolean;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  filters: FilterState;
  activeFilterGroup: FilterGroup;
  customFields: CustomFieldDefinition[];
  onFilterOpenChange: (open: boolean) => void;
  onFiltersChange: (filters: FilterState) => void;
  onAdvancedFilterChange: (group: FilterGroup) => void;
  onClearFilters: () => void;
}

const fieldClass =
  "w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-red-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20";

export const HeaderFilterPopover: React.FC<HeaderFilterPopoverProps> = ({
  isFilterOpen,
  hasActiveFilters,
  activeFilterCount,
  filters,
  activeFilterGroup,
  customFields,
  onFilterOpenChange,
  onFiltersChange,
  onAdvancedFilterChange,
  onClearFilters,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = isFilterOpen || isHovered;

  const cancelLeave = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelLeave();
    leaveTimerRef.current = setTimeout(() => {
      setIsHovered(false);
      onFilterOpenChange(false);
      leaveTimerRef.current = null;
    }, 180);
  };

  useEffect(
    () => () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const panelWidth = Math.min(520, window.innerWidth - 32);
      const left = Math.min(
        Math.max(16, rect.right - panelWidth),
        window.innerWidth - panelWidth - 16,
      );

      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 10,
        left,
        width: panelWidth,
        zIndex: 60,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHovered(false);
        onFilterOpenChange(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onFilterOpenChange]);

  const tooltipLabel = hasActiveFilters
    ? `Filters — ${activeFilterCount} active`
    : "Filters — hover to refine tasks";

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={() => {
        cancelLeave();
        setIsHovered(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <Tooltip content={tooltipLabel} position="bottom">
        <IconButton
          active={isOpen || hasActiveFilters}
          aria-label={
            hasActiveFilters
              ? `Filters, ${activeFilterCount} active`
              : "Filters"
          }
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={() => onFilterOpenChange(!isFilterOpen)}
        >
          <Filter size={18} />
          {hasActiveFilters && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            >
              {activeFilterCount}
            </span>
          )}
        </IconButton>
      </Tooltip>

      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Task filters"
            style={menuStyle}
            className="liquid-surface overflow-hidden rounded-2xl border border-white/10 shadow-2xl animate-in fade-in zoom-in-95 duration-150 origin-top-right"
            onMouseEnter={cancelLeave}
            onMouseLeave={scheduleClose}
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Filters
                </p>
                <p className="text-xs text-slate-400">
                  {hasActiveFilters
                    ? `${activeFilterCount} active constraint${activeFilterCount === 1 ? "" : "s"}`
                    : "Refine what shows on the board"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={onClearFilters}
                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsHovered(false);
                    onFilterOpenChange(false);
                  }}
                  className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
                  aria-label="Close filters"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="max-h-[min(420px,70vh)] overflow-y-auto custom-scrollbar p-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="filter-assignee"
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500"
                  >
                    <User size={10} /> Assignee
                  </label>
                  <input
                    id="filter-assignee"
                    type="text"
                    value={filters.assignee}
                    onChange={(e) => onFiltersChange({ ...filters, assignee: e.target.value })}
                    className={fieldClass}
                    placeholder="Name…"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="filter-tag"
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500"
                  >
                    <Tag size={10} /> Tag
                  </label>
                  <input
                    id="filter-tag"
                    type="text"
                    value={filters.tags}
                    onChange={(e) => onFiltersChange({ ...filters, tags: e.target.value })}
                    className={fieldClass}
                    placeholder="Category…"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <Calendar size={10} /> Date Range
                  </label>
                  <select
                    value={filters.dateRange || ""}
                    onChange={(e) =>
                      onFiltersChange({
                        ...filters,
                        dateRange: e.target.value as FilterState["dateRange"],
                      })
                    }
                    className={fieldClass}
                    aria-label="Date range filter type"
                  >
                    <option value="">None</option>
                    <option value="due">Due Date</option>
                    <option value="created">Created Date</option>
                  </select>
                </div>
              </div>

              {filters.dateRange && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-black/20 p-3">
                  <label className="sr-only">Start date</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })}
                    className={`${fieldClass} w-auto flex-1 min-w-[8.5rem]`}
                    aria-label="Start date"
                  />
                  <span className="text-xs text-slate-500">to</span>
                  <label className="sr-only">End date</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })}
                    className={`${fieldClass} w-auto flex-1 min-w-[8.5rem]`}
                    aria-label="End date"
                  />
                </div>
              )}

              <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Advanced Query
                </p>
                <Suspense fallback={null}>
                  <FilterBuilder
                    rootGroup={activeFilterGroup}
                    onChange={onAdvancedFilterChange}
                    customFields={customFields}
                  />
                </Suspense>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
