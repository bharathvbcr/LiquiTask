import type React from "react";

import { GlassPanel } from "./GlassPanel";

export interface FlatCardProps {
  children?: React.ReactNode;
  className?: string;
}

/** Padded, rounded flat glass card for list items — run cards, roster rows. */
export const FlatCard: React.FC<FlatCardProps> = ({ children, className = "" }) => {
  return (
    <GlassPanel
      className={`rounded-xl bg-white/5 border-white/5 shadow-none p-2.5 space-y-2 hover:bg-white/[0.07] transition-colors ${className}`}
    >
      {children}
    </GlassPanel>
  );
};

export default FlatCard;
