import type React from "react";

import { getPriorityIcon } from "../utils/taskCardUtils";

interface PriorityBadgeProps {
  label: string;
  color: string;
  icon?: string;
  showIcon?: boolean;
  className?: string;
}

/** Read-only priority chip — color and icon come from the resolved priority definition. */
export const PriorityBadge: React.FC<PriorityBadgeProps> = ({
  label,
  color,
  icon,
  showIcon = true,
  className = "",
}) => {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${className}`}
      style={{ backgroundColor: `${color}22`, color }}
    >
      {showIcon && icon && getPriorityIcon(icon, 10)}
      {label}
    </span>
  );
};

export default PriorityBadge;
