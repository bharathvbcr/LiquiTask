import type React from "react";

export type ToggleTone = "red" | "amber";

const TONE_ON: Record<ToggleTone, string> = {
  red: "bg-gradient-to-br from-red-700 to-red-900 border-red-500/50 shadow-[0_0_12px_rgba(220,38,38,0.4)]",
  amber: "bg-gradient-to-br from-amber-600 to-amber-800 border-amber-500/50 shadow-[0_0_12px_rgba(217,119,6,0.4)]",
};

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  tone?: ToggleTone;
  "aria-label": string;
  className?: string;
}

/** Liquid-glass switch — gradient fill + glow when on, recessed track when off. */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  tone = "red",
  "aria-label": ariaLabel,
  className = "",
}) => {
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      className={`relative w-12 h-6 rounded-full shrink-0 border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:ring-red-500 ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? TONE_ON[tone] : "bg-black/50 border-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"} ${className}`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
};

export default Toggle;
