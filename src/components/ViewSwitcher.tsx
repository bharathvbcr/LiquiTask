import React from 'react';
import { Layout, GanttChart, BarChart3, Calendar } from 'lucide-react';
import { Tooltip } from './Tooltip';

export type ViewMode = 'board' | 'gantt' | 'stats' | 'calendar';

interface ViewSwitcherProps {
  currentView: 'project' | 'dashboard' | 'gantt';
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
  // When in project view, show Board/Gantt options
  if (currentView === 'project') {
    // If hiding Board and Gantt, return null since those are the only options
    if (hideBoardAndGantt) {
      return null;
    }
    return (
      <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
        <Tooltip
          content={
            <div className="text-sm">
              <div className="font-semibold text-white mb-1">Board View</div>
              <div className="text-slate-300 text-xs leading-relaxed">
                Kanban board with drag-and-drop task management and customizable columns. Best for workflow visualization and status tracking.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform ${
              viewMode === 'board'
                ? 'bg-red-500/20 text-red-400 scale-105'
                : 'text-slate-400 hover:text-white hover:scale-105 hover:bg-white/5'
            }`}
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
                Timeline view showing task dependencies and durations. Essential for project planning and identifying critical paths.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange('gantt')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform ${
              viewMode === 'gantt'
                ? 'bg-red-500/20 text-red-400 scale-105'
                : 'text-slate-400 hover:text-white hover:scale-105 hover:bg-white/5'
            }`}
          >
            <GanttChart size={14} />
            {!isCompact && <span>Gantt</span>}
          </button>
        </Tooltip>
      </div>
    );
  }

  // When in dashboard view, show Stats/Calendar/Board/Gantt options
  if (currentView === 'dashboard') {
    return (
      <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
        <Tooltip
          content={
            <div className="text-sm">
              <div className="font-semibold text-white mb-1">Stats View</div>
              <div className="text-slate-300 text-xs leading-relaxed">
                Analytics dashboard with task metrics, completion rates, and priority breakdowns. Perfect for tracking progress and identifying bottlenecks.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange('stats')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform ${
              viewMode === 'stats'
                ? 'bg-red-500/20 text-red-400 scale-105'
                : 'text-slate-400 hover:text-white hover:scale-105 hover:bg-white/5'
            }`}
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
                See tasks organized by due dates in a monthly or weekly calendar. Ideal for scheduling and deadline management.
              </div>
            </div>
          }
          position="bottom"
        >
          <button
            onClick={() => onViewModeChange('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform ${
              viewMode === 'calendar'
                ? 'bg-red-500/20 text-red-400 scale-105'
                : 'text-slate-400 hover:text-white hover:scale-105 hover:bg-white/5'
            }`}
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
                    Kanban board with drag-and-drop task management and customizable columns. Best for workflow visualization and status tracking.
                  </div>
                </div>
              }
              position="bottom"
            >
              <button
                onClick={() => onViewModeChange('board')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'board'
                    ? 'bg-red-500/20 text-red-400'
                    : 'text-slate-400 hover:text-white'
                }`}
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
                    Timeline view showing task dependencies and durations. Essential for project planning and identifying critical paths.
                  </div>
                </div>
              }
              position="bottom"
            >
              <button
                onClick={() => onViewModeChange('gantt')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'gantt'
                    ? 'bg-red-500/20 text-red-400'
                    : 'text-slate-400 hover:text-white'
                }`}
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
