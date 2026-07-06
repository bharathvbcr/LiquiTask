import type React from "react";

import { GlassPanel } from "./GlassPanel";

export interface GlassCardProps {
  children?: React.ReactNode;
  className?: string;
}

/** Padded, rounded glass card for list items — task cards, run cards, roster rows. */
export const GlassCard: React.FC<GlassCardProps> = ({ children, className = "" }) => {
  return (
    <GlassPanel
      className={`rounded-xl bg-white/5 border-white/5 shadow-none p-2.5 space-y-2 hover:bg-white/[0.07] transition-colors ${className}`}
    >
      {children}
    </GlassPanel>
  );
};

export default GlassCard;
