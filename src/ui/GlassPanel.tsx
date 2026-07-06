import type React from "react";

export interface GlassPanelProps {
  children?: React.ReactNode;
  className?: string;
}

/** Generic frosted-glass container — the base surface every card wraps. */
export const GlassPanel: React.FC<GlassPanelProps> = ({ children, className = "" }) => {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-2xl ${className}`}
    >
      {children}
    </div>
  );
};

export default GlassPanel;
