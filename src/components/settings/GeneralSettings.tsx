import {
  Bot,
  FolderTree,
  Kanban,
  Layout,
  MonitorSmartphone,
  Palette,
  Sparkles,
  Bell,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { GroupingOption, ToastType } from "../../../types";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "../../utils/notificationPreferences";
import {
  getMaxConcurrentAgentRuns,
  setMaxConcurrentAgentRuns,
} from "../../utils/agentRunLimits";
import {
  DEFAULT_REMOTE_PUSH_CONFIG,
  type RemotePushConfig,
  type RemotePushProvider,
} from "../../utils/pushNotificationConfig";
import {
  getManualReducedEffectsPreference,
  setManualReducedEffectsPreference,
} from "../../utils/gpuDetection";
import { SettingsToggle } from "./SettingsToggle";

interface GeneralSettingsProps {
  localGrouping: GroupingOption;
  setLocalGrouping: (val: GroupingOption) => void;
  showSubWorkspaceTasks: boolean;
  onUpdateShowSubWorkspaceTasks?: (val: boolean) => void;
  aiFeaturesEnabled: boolean;
  onUpdateAiFeaturesEnabled?: (val: boolean) => void;
  agentExecutionEnabled: boolean;
  onUpdateAgentExecutionEnabled?: (val: boolean) => void;
  notificationPreferences?: NotificationPreferences;
  onUpdateNotificationPreferences?: (prefs: NotificationPreferences) => void;
  remotePushConfig?: RemotePushConfig;
  onUpdateRemotePushConfig?: (config: RemotePushConfig) => void;
  addToast: (msg: string, type: ToastType) => void;
  onUpdateGrouping: (val: GroupingOption) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  localGrouping,
  setLocalGrouping,
  showSubWorkspaceTasks,
  onUpdateShowSubWorkspaceTasks,
  aiFeaturesEnabled,
  onUpdateAiFeaturesEnabled,
  agentExecutionEnabled,
  onUpdateAgentExecutionEnabled,
  notificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES,
  onUpdateNotificationPreferences,
  remotePushConfig = DEFAULT_REMOTE_PUSH_CONFIG,
  onUpdateRemotePushConfig,
  addToast,
  onUpdateGrouping,
}) => {
  const [activeTheme, setActiveTheme] = useState<"dark" | "light">("dark");
  const [reduceEffects, setReduceEffects] = useState(false);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(() => getMaxConcurrentAgentRuns());

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isLight = stored === "light" || document.documentElement.classList.contains("theme-light");
    setActiveTheme(isLight ? "light" : "dark");
    setReduceEffects(getManualReducedEffectsPreference());
    setMaxConcurrentRuns(getMaxConcurrentAgentRuns());
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

  const toggleReduceEffects = (checked: boolean) => {
    setManualReducedEffectsPreference(checked);
    setReduceEffects(checked);
    addToast(checked ? "Visual effects reduced" : "Visual effects restored", "info");
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
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Features</h4>
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <Sparkles size={18} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">Enable AI Features</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                In-app AI assistance: assistant, insights, auto-organize, and quick-add AI. Does
                not start any agents. Your settings are kept when off.
              </p>
            </div>
          </div>
          <SettingsToggle
            checked={aiFeaturesEnabled}
            onChange={(val) => onUpdateAiFeaturesEnabled?.(val)}
            color="cyan"
            aria-label="Toggle AI features"
          />
        </div>
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <Bot size={18} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">Enable Agent Execution</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Coding-agent runs on your board — Inbox and Agents surfaces, auto-pickup, and
                approvals. Turn off to keep AI assistance without agents running. Run history is
                kept.
              </p>
            </div>
          </div>
          <SettingsToggle
            checked={agentExecutionEnabled}
            onChange={(val) => onUpdateAgentExecutionEnabled?.(val)}
            color="cyan"
            aria-label="Toggle agent execution"
          />
        </div>
        {agentExecutionEnabled && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
            <div>
              <h4 className="text-sm font-medium text-white">Max Concurrent Agent Runs</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Limit how many agents may run at once across the board. 0 = unlimited.
              </p>
            </div>
            <input
              type="number"
              min={0}
              max={99}
              value={maxConcurrentRuns}
              onChange={(e) => {
                const next = Math.max(0, Math.min(99, Number.parseInt(e.target.value, 10) || 0));
                setMaxConcurrentRuns(next);
                setMaxConcurrentAgentRuns(next);
                addToast(
                  next === 0
                    ? "Concurrent run cap removed"
                    : `Concurrent run cap set to ${next}`,
                  "info",
                );
              }}
              className="w-20 liquid-input rounded-lg px-3 py-2 text-sm text-center"
              aria-label="Max concurrent agent runs"
            />
          </div>
        )}
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Notifications
        </h4>
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <Bell size={18} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">Quiet Hours</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Suppress task reminders and overdue nudges during these hours.
              </p>
            </div>
          </div>
          <SettingsToggle
            checked={notificationPreferences.quietHoursEnabled}
            onChange={(quietHoursEnabled) =>
              onUpdateNotificationPreferences?.({ ...notificationPreferences, quietHoursEnabled })
            }
            color="cyan"
            aria-label="Toggle quiet hours"
          />
        </div>
        {notificationPreferences.quietHoursEnabled && (
          <div className="grid grid-cols-2 gap-3 px-1">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">Start</span>
              <input
                type="time"
                value={notificationPreferences.quietHoursStart}
                onChange={(e) =>
                  onUpdateNotificationPreferences?.({
                    ...notificationPreferences,
                    quietHoursStart: e.target.value,
                  })
                }
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">End</span>
              <input
                type="time"
                value={notificationPreferences.quietHoursEnd}
                onChange={(e) =>
                  onUpdateNotificationPreferences?.({
                    ...notificationPreferences,
                    quietHoursEnd: e.target.value,
                  })
                }
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
        )}
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div>
            <h4 className="text-sm font-medium text-white">Due-Date Lead Time</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              How many minutes before a due time to send the &quot;due soon&quot; reminder.
            </p>
          </div>
          <input
            type="number"
            min={0}
            max={1440}
            step={15}
            value={notificationPreferences.dueDateLeadMinutes}
            onChange={(e) =>
              onUpdateNotificationPreferences?.({
                ...notificationPreferences,
                dueDateLeadMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)),
              })
            }
            className="w-20 liquid-input rounded-lg px-2 py-1.5 text-sm text-right"
            aria-label="Due-date lead time in minutes"
          />
        </div>
        {agentExecutionEnabled && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div>
            <h4 className="text-sm font-medium text-white">Agent Attention Alerts</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Notify when agents need permission, are queued, or finish a run.
            </p>
          </div>
          <SettingsToggle
            checked={notificationPreferences.agentAttentionEnabled}
            onChange={(agentAttentionEnabled) =>
              onUpdateNotificationPreferences?.({
                ...notificationPreferences,
                agentAttentionEnabled,
              })
            }
            color="cyan"
            aria-label="Toggle agent attention alerts"
          />
        </div>
        )}
        <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-white">Remote Push (App Closed)</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Pushover or a generic webhook via agentd. Credentials are encrypted at rest.
              </p>
            </div>
            <SettingsToggle
              checked={remotePushConfig.enabled}
              onChange={(enabled) =>
                onUpdateRemotePushConfig?.({ ...remotePushConfig, enabled })
              }
              color="cyan"
              aria-label="Toggle remote push notifications"
            />
          </div>
          {remotePushConfig.enabled && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <label className="block space-y-1">
                <span className="text-xs text-slate-500">Provider</span>
                <select
                  value={remotePushConfig.provider}
                  onChange={(e) =>
                    onUpdateRemotePushConfig?.({
                      ...remotePushConfig,
                      provider: e.target.value as RemotePushProvider,
                    })
                  }
                  className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
                  aria-label="Remote push provider"
                >
                  <option value="none">Select provider…</option>
                  <option value="pushover">Pushover</option>
                  <option value="webhook">Generic webhook</option>
                </select>
              </label>
              {remotePushConfig.provider === "pushover" && (
                <>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500">Pushover user key</span>
                    <input
                      type="password"
                      value={remotePushConfig.pushoverUserKey}
                      onChange={(e) =>
                        onUpdateRemotePushConfig?.({
                          ...remotePushConfig,
                          pushoverUserKey: e.target.value,
                        })
                      }
                      className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500">Pushover API token</span>
                    <input
                      type="password"
                      value={remotePushConfig.pushoverApiToken}
                      onChange={(e) =>
                        onUpdateRemotePushConfig?.({
                          ...remotePushConfig,
                          pushoverApiToken: e.target.value,
                        })
                      }
                      className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
              {remotePushConfig.provider === "webhook" && (
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500">Webhook URL</span>
                  <input
                    type="url"
                    value={remotePushConfig.webhookUrl}
                    onChange={(e) =>
                      onUpdateRemotePushConfig?.({
                        ...remotePushConfig,
                        webhookUrl: e.target.value,
                      })
                    }
                    placeholder="https://example.com/hooks/liquitask"
                    className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                </label>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
          <div>
            <h4 className="text-sm font-medium text-white">Overdue Nudges</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Notify when tasks pass their due date (checked every minute).
            </p>
          </div>
          <SettingsToggle
            checked={notificationPreferences.overdueNudgesEnabled}
            onChange={(overdueNudgesEnabled) =>
              onUpdateNotificationPreferences?.({ ...notificationPreferences, overdueNudgesEnabled })
            }
            color="cyan"
            aria-label="Toggle overdue nudges"
          />
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

        <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 mt-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <MonitorSmartphone size={18} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">Reduce Visual Effects</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Turn off background blur and ambient animation for smoother performance on
                older or integrated graphics. LiquiTask does this automatically when it
                detects a software renderer — use this if animations still feel slow.
              </p>
            </div>
          </div>
          <SettingsToggle
            checked={reduceEffects}
            onChange={toggleReduceEffects}
            color="cyan"
            aria-label="Toggle reduced visual effects"
          />
        </div>
      </div>
    </div>
  );
};
