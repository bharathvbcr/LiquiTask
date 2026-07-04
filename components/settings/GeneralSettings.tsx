import { FolderTree, Kanban, Layout, Palette } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { GroupingOption, ToastType } from "../../types";
import { SettingsToggle } from "./SettingsToggle";

interface GeneralSettingsProps {
  localGrouping: GroupingOption;
  setLocalGrouping: (val: GroupingOption) => void;
  showSubWorkspaceTasks: boolean;
  onUpdateShowSubWorkspaceTasks?: (val: boolean) => void;
  addToast: (msg: string, type: ToastType) => void;
  onUpdateGrouping: (val: GroupingOption) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  localGrouping,
  setLocalGrouping,
  showSubWorkspaceTasks,
  onUpdateShowSubWorkspaceTasks,
  addToast,
  onUpdateGrouping,
}) => {
  const [activeTheme, setActiveTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isLight = stored === "light" || document.documentElement.classList.contains("theme-light");
    setActiveTheme(isLight ? "light" : "dark");
  }, []);

  const setTheme = (theme: "dark" | "light") => {
    if (theme === "light") {
      document.documentElement.classList.add("theme-light");
      localStorage.setItem("theme", "light");
      addToast("Light mode enabled", "info");
    } else {
      document.documentElement.classList.remove("theme-light");
      localStorage.setItem("theme", "dark");
      addToast("Dark mode enabled", "info");
    }
    setActiveTheme(theme);
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Board Layout
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setLocalGrouping("none");
              onUpdateGrouping("none");
            }}
            className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${localGrouping === "none" ? "bg-red-500/10 border-red-500 text-red-400" : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"}`}
            aria-pressed={localGrouping === "none"}
          >
            <Kanban size={24} />
            <span className="text-xs font-bold">Standard</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLocalGrouping("priority");
              onUpdateGrouping("priority");
            }}
            className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${localGrouping === "priority" ? "bg-red-500/10 border-red-500 text-red-400" : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"}`}
            aria-pressed={localGrouping === "priority"}
          >
            <Layout size={24} />
            <span className="text-xs font-bold">Swimlanes</span>
          </button>
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</h4>
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <FolderTree size={18} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">Show Sub-Workspace Tasks</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Include tasks from nested workspaces on the board.
              </p>
            </div>
          </div>
          <SettingsToggle
            checked={showSubWorkspaceTasks}
            onChange={(val) => onUpdateShowSubWorkspaceTasks?.(val)}
            color="cyan"
            aria-label="Toggle sub-workspace tasks"
          />
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Appearance
        </h4>
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <Palette size={18} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">Theme</h4>
              <p className="text-xs text-slate-500 mt-0.5">Choose your preferred color scheme.</p>
            </div>
          </div>
          <div className="flex gap-1.5 p-1 rounded-xl bg-black/30 border border-white/5">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                activeTheme === "dark"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              aria-pressed={activeTheme === "dark"}
            >
              Dark
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                activeTheme === "light"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              aria-pressed={activeTheme === "light"}
            >
              Light
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
