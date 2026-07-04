import type React from "react";
import { useCallback } from "react";

type ToggleColor = "violet" | "cyan" | "purple" | "amber";

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: ToggleColor;
  "aria-label": string;
}

const colorStyles: Record<ToggleColor, { track: string; thumb: string }> = {
  violet: { track: "bg-red-500/20", thumb: "bg-red-400" },
  cyan: { track: "bg-red-500/20", thumb: "bg-red-400" },
  purple: { track: "bg-red-500/20", thumb: "bg-red-400" },
  amber: { track: "bg-amber-500/20", thumb: "bg-amber-400" },
};

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  color = "violet",
  "aria-label": ariaLabel,
}) => {
  const handleToggle = useCallback(() => {
    if (!disabled) onChange(!checked);
  }, [checked, onChange, disabled]);

  const styles = colorStyles[color];

  const focusRing =
    color === "cyan"
      ? "focus-visible:ring-red-500"
      : color === "amber"
        ? "focus-visible:ring-amber-500"
        : color === "purple"
          ? "focus-visible:ring-red-500"
          : "focus-visible:ring-red-500";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToggle();
        }
      }}
      className={`relative w-12 h-6 rounded-full transition-all shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${focusRing} ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? styles.track : "bg-slate-700/50"}`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 shadow-sm ${
          checked ? `${styles.thumb} translate-x-6` : "bg-slate-500 translate-x-0"
        }`}
      />
    </button>
  );
};
