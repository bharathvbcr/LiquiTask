import {
  Bell,
  Brain,
  Maximize2,
  MessageSquare,
  Minimize2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { IconButton } from "./common/IconButton";
import { Popover } from "./common/Popover";
import { Tooltip } from "./Tooltip";

interface HeaderToolsMenuProps {
  canUndo: boolean;
  isCompactView: boolean;
  notificationPermission: "granted" | "denied" | "default";
  onUndo: () => void;
  onToggleCompactView: () => void;
  onRequestNotificationPermission: () => void;
  onAiPrioritize?: () => void;
  onAiInsights?: () => void;
  onToggleAssistant?: () => void;
}

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}

const MenuRow: React.FC<MenuRowProps> = ({
  icon,
  label,
  hint,
  disabled,
  active,
  onClick,
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? "bg-red-500/10 text-red-200"
        : "text-slate-300 hover:bg-white/5 hover:text-white"
    }`}
  >
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-slate-400">
      {icon}
    </span>
    <span className="min-w-0 flex-1 font-medium">{label}</span>
    {hint && (
      <span className="shrink-0 rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
        {hint}
      </span>
    )}
  </button>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
    {children}
  </p>
);

export const HeaderToolsMenu: React.FC<HeaderToolsMenuProps> = ({
  canUndo,
  isCompactView,
  notificationPermission,
  onUndo,
  onToggleCompactView,
  onRequestNotificationPermission,
  onAiPrioritize,
  onAiInsights,
  onToggleAssistant,
}) => {
  const [open, setOpen] = useState(false);
  const hasAiTools = Boolean(onAiPrioritize || onAiInsights || onToggleAssistant);
  const hasActiveToolState = isCompactView || notificationPermission === "granted";

  const closeAnd = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      contentClassName="w-72 rounded-2xl border border-white/10 bg-black/80 p-2 shadow-2xl backdrop-blur-xl liquid-surface"
      trigger={
        <Tooltip content="Board Tools — layout, AI, and preferences" position="bottom">
          <IconButton
            active={open || hasActiveToolState}
            aria-label="Board tools menu"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            <SlidersHorizontal size={18} />
          </IconButton>
        </Tooltip>
      }
    >
      <SectionLabel>Actions</SectionLabel>
      <MenuRow
        icon={<Undo2 size={16} />}
        label="Undo"
        hint="⌘Z"
        disabled={!canUndo}
        onClick={closeAnd(onUndo)}
      />
      <MenuRow
        icon={isCompactView ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
        label={isCompactView ? "Expand View" : "Compact View"}
        active={isCompactView}
        onClick={closeAnd(onToggleCompactView)}
      />

      {hasAiTools && (
        <>
          <SectionLabel>AI</SectionLabel>
          {onAiPrioritize && (
            <MenuRow
              icon={<Sparkles size={16} />}
              label="AI Prioritize"
              onClick={closeAnd(onAiPrioritize)}
            />
          )}
          {onAiInsights && (
            <MenuRow
              icon={<Brain size={16} />}
              label="AI Insights"
              onClick={closeAnd(onAiInsights)}
            />
          )}
          {onToggleAssistant && (
            <MenuRow
              icon={<MessageSquare size={16} />}
              label="AI Assistant"
              hint="⌘J"
              onClick={closeAnd(onToggleAssistant)}
            />
          )}
        </>
      )}

      <SectionLabel>Preferences</SectionLabel>
      <MenuRow
        icon={<Bell size={16} />}
        label={
          notificationPermission === "granted"
            ? "Notifications On"
            : notificationPermission === "denied"
              ? "Notifications Blocked"
              : "Enable Notifications"
        }
        active={notificationPermission === "granted"}
        onClick={closeAnd(onRequestNotificationPermission)}
      />
    </Popover>
  );
};
