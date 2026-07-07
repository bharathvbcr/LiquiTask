import { BarChart3, Calendar, GanttChart, Layout } from "lucide-react";
import type React from "react";
import { Tooltip } from "./Tooltip";

export type ViewMode = "board" | "gantt" | "stats" | "calendar";

interface ViewSwitcherProps {
  currentView: "project" | "dashboard" | "gantt" | "archive";
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isCompact?: boolean;
  hideBoardAndGantt?: boolean;
}

export const ViewSwitcher: React.FC<ViewSwitcherProps> = ({
  currentView,
  viewMode,
  onViewModeChange,
  isCompact = false,
  hideBoardAndGantt = false,
}) => {
  const shellClass = "flex items-center gap-0.5 liquid-glass rounded-full p-1 shadow-lg";
  const segmentClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 ${
      active
        ? "bg-red-500/20 text-red-400"
        : "text-slate-400 hover:bg-white/5 hover:text-white"
    }`;

  // When in project view, show Board/Gantt options
  if (currentView === "project") {
    // If hiding Board and Gantt, return null since those are the only options
    if (hideBoardAndGantt) {
      return null;
    }
    return (
      <div className={shellClass}>
        <Tooltip
          content={
            <div className="text-sm">
              <div className="font-semibold text-white mb-1">Board View</div>
              <div className="text-slate-300 text-xs leading-relaxed">
                Kanban board with drag-and-drop task management and customizable columns. Best for
                workflow visualization and status tracking.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange("board")}
            aria-label="Board view"
            aria-pressed={viewMode === "board"}
            className={segmentClass(viewMode === "board")}
          >
            <Layout size={14} />
            {!isCompact && <span>Board</span>}
          </button>
        </Tooltip>
        <Tooltip
          content={
            <div className="text-sm">
              <div className="font-semibold text-white mb-1">Gantt View</div>
              <div className="text-slate-300 text-xs leading-relaxed">
                Timeline view showing task dependencies and durations. Essential for project
                planning and identifying critical paths.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange("gantt")}
            aria-label="Gantt view"
            aria-pressed={viewMode === "gantt"}
            className={segmentClass(viewMode === "gantt")}
          >
            <GanttChart size={14} />
            {!isCompact && <span>Gantt</span>}
          </button>
        </Tooltip>
      </div>
    );
  }

  // When in dashboard view, show Stats/Calendar/Board/Gantt options
  if (currentView === "dashboard") {
    return (
      <div className={shellClass}>
        <Tooltip
          content={
            <div className="text-sm">
              <div className="font-semibold text-white mb-1">Stats View</div>
              <div className="text-slate-300 text-xs leading-relaxed">
                Analytics dashboard with task metrics, completion rates, and priority breakdowns.
                Perfect for tracking progress and identifying bottlenecks.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange("stats")}
            aria-label="Stats view"
            aria-pressed={viewMode === "stats"}
            className={segmentClass(viewMode === "stats")}
          >
            <BarChart3 size={14} />
            {!isCompact && <span>Stats</span>}
          </button>
        </Tooltip>
        <Tooltip
          content={
            <div className="text-sm">
              <div className="font-semibold text-white mb-1">Calendar View</div>
              <div className="text-slate-300 text-xs leading-relaxed">
                See tasks organized by due dates in a monthly or weekly calendar. Ideal for
                scheduling and deadline management.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange("calendar")}
            aria-label="Calendar view"
            aria-pressed={viewMode === "calendar"}
            className={segmentClass(viewMode === "calendar")}
          >
            <Calendar size={14} />
            {!isCompact && <span>Calendar</span>}
          </button>
        </Tooltip>
        {!hideBoardAndGantt && (
          <>
            <Tooltip
              content={
                <div className="text-sm">
                  <div className="font-semibold text-white mb-1">Board View</div>
                  <div className="text-slate-300 text-xs leading-relaxed">
                    Kanban board with drag-and-drop task management and customizable columns. Best
                    for workflow visualization and status tracking.
                  </div>
                </div>
              }
              position="bottom"
            >
              <button
                onClick={() => onViewModeChange("board")}
                aria-label="Board view"
                aria-pressed={viewMode === "board"}
                className={segmentClass(viewMode === "board")}
              >
                <Layout size={14} />
                {!isCompact && <span>Board</span>}
              </button>
            </Tooltip>
            <Tooltip
              content={
                <div className="text-sm">
                  <div className="font-semibold text-white mb-1">Gantt View</div>
                  <div className="text-slate-300 text-xs leading-relaxed">
                    Timeline view showing task dependencies and durations. Essential for project
                    planning and identifying critical paths.
                  </div>
                </div>
              }
              position="bottom"
            >
              <button
                onClick={() => onViewModeChange("gantt")}
                aria-label="Gantt view"
                aria-pressed={viewMode === "gantt"}
                className={segmentClass(viewMode === "gantt")}
              >
                <GanttChart size={14} />
                {!isCompact && <span>Gantt</span>}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    );
  }

  // Fallback for gantt view (shouldn't happen with new system)
  return null;
};
