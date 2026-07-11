import type React from "react";
import type { Task } from "../../../types";

interface ActivityTimelineProps {
  activity: Task["activity"];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ activity }) => (
  <div className="flex flex-col h-full min-h-[400px]">
    <div className="space-y-4 p-1">
      {activity
        ?.slice()
        .reverse()
        .map((item, idx) => (
          <div key={item.id || idx} className="flex gap-4 group">
            <div className="flex flex-col items-center">
              <div
                className={`w-2 h-2 rounded-full mt-2 ${
                  item.type === "create"
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    : item.type === "move"
                      ? "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]"
                      : item.type === "delete"
                        ? "bg-red-500"
                        : "bg-slate-500"
                }`}
              />
              {idx !== (activity?.length || 0) - 1 && (
                <div className="w-px h-full bg-white/10 my-1" />
              )}
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  {item.type}
                </span>
                <span className="text-[10px] text-slate-500">
                  {(() => {
                    const ts = new Date(item.timestamp);
                    return Number.isNaN(ts.getTime()) ? "Unknown date" : ts.toLocaleString();
                  })()}
                </span>
              </div>
              <p className="text-sm text-slate-400 bg-white/5 p-3 rounded-xl border border-white/5 group-hover:border-white/10 transition-colors">
                {item.details}
              </p>
            </div>
          </div>
        )) || (
        <div className="text-center text-slate-500 py-10 italic">No activity recorded.</div>
      )}
    </div>
  </div>
);
