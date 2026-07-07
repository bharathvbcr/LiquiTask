import type React from "react";

import { Toggle, type ToggleTone } from "../common/Toggle";

type ToggleColor = "violet" | "cyan" | "purple" | "amber";

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: ToggleColor;
  "aria-label": string;
}

// Legacy color names predate the single-crimson-accent brand pass — only the
// tone (red vs amber) still varies, kept here so call sites don't need updating.
const TONE_BY_COLOR: Record<ToggleColor, ToggleTone> = {
  violet: "red",
  cyan: "red",
  purple: "red",
  amber: "amber",
};

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  color = "violet",
  "aria-label": ariaLabel,
}) => {
  return (
    <Toggle
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      tone={TONE_BY_COLOR[color]}
      aria-label={ariaLabel}
    />
  );
};
