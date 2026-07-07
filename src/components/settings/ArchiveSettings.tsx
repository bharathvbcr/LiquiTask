import { Archive, CheckCircle2, Loader2, Play } from "lucide-react";
import type React from "react";
import { useState } from "react";
import {
  DEFAULT_ARCHIVE_SETTINGS,
  loadArchiveSettings,
  type StoredArchiveSettings,
  saveArchiveSettings,
} from "../../services/archiveService";
import type { ToastType } from "../../../types";
import { SettingsToggle } from "./SettingsToggle";

interface ArchiveSettingsProps {
  onRunAutoArchive: (options?: { force?: boolean }) => Promise<number>;
  addToast?: (msg: string, type: ToastType) => void;
}

export const ArchiveSettings: React.FC<ArchiveSettingsProps> = ({
  onRunAutoArchive,
  addToast,
}) => {
  const [settings, setSettings] = useState<StoredArchiveSettings>(() => loadArchiveSettings());
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunCount, setLastRunCount] = useState<number | null>(null);

  const persistSettings = (next: StoredArchiveSettings) => {
    saveArchiveSettings(next);
    setSettings(loadArchiveSettings());
  };

  const updateNumber = (field: "autoArchiveAfterDays" | "retentionDays", raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    persistSettings({ ...settings, [field]: parsed });
  };

  const handleRunNow = async () => {
    setIsRunning(true);
    setLastRunCount(null);
    try {
      const count = await onRunAutoArchive({ force: true });
      setLastRunCount(count);
      if (addToast) {
        addToast(
          count > 0
            ? `Archived ${count} task${count === 1 ? "" : "s"}`
            : "No tasks met the archive criteria",
          count > 0 ? "success" : "info",
        );
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4 pt-6 border-t border-white/5 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
          <Archive size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Auto-Archive</h3>
          <p className="text-sm text-slate-400">
            Move old completed tasks out of the active board into the archive.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
        <div>
          <h4 className="text-sm font-medium text-white">Enable auto-archive</h4>
          <p className="text-xs text-slate-500 mt-1">
            Runs on startup and hourly while the app is open.
          </p>
        </div>
        <SettingsToggle
          checked={settings.enabled}
          onChange={(enabled) => persistSettings({ ...settings, enabled })}
          color="violet"
          aria-label="Toggle auto-archive"
        />
      </div>

      <div
        className={`grid grid-cols-1 sm:grid-cols-2 gap-3 transition-opacity duration-200 ${settings.enabled ? "" : "opacity-50"}`}
      >
        <label className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
          <span className="text-sm font-medium text-white">Archive after (days)</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={settings.autoArchiveAfterDays}
            onChange={(e) => updateNumber("autoArchiveAfterDays", e.target.value)}
            disabled={!settings.enabled}
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed"
          />
          <span className="text-xs text-slate-500 block">
            Completed tasks older than this are moved to the archive.
          </span>
        </label>

        <label className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
          <span className="text-sm font-medium text-white">Retention (days)</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={settings.retentionDays}
            onChange={(e) => updateNumber("retentionDays", e.target.value)}
            disabled={!settings.enabled}
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed"
          />
          <span className="text-xs text-slate-500 block">
            Archived tasks older than this are permanently deleted on startup.
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={handleRunNow}
        disabled={isRunning}
        className="flex items-center justify-center gap-2 w-full p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
        <span className="text-sm font-medium">Run auto-archive now</span>
      </button>

      {lastRunCount !== null && (
        <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 animate-in fade-in">
          <CheckCircle2 size={14} />
          {lastRunCount > 0
            ? `Archived ${lastRunCount} task${lastRunCount === 1 ? "" : "s"}`
            : "No tasks met the archive criteria"}
        </div>
      )}

      {!settings.enabled && (
        <p className="text-xs text-slate-500 text-center">
          Enable auto-archive to run this automatically. Manual runs still work.
        </p>
      )}

      <p className="text-xs text-slate-600 text-center">
        Defaults: {DEFAULT_ARCHIVE_SETTINGS.autoArchiveAfterDays} day grace period,{" "}
        {DEFAULT_ARCHIVE_SETTINGS.retentionDays} day retention.
      </p>
    </div>
  );
};
