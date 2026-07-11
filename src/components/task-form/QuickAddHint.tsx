import type React from "react";

export const QuickAddHint: React.FC<{ label: string; description: string }> = ({
  label,
  description,
}) => (
  <div className="flex items-center gap-1 text-[10px]">
    <kbd className="px-1.5 py-0.5 liquid-glass rounded-md text-white/80 font-mono border border-white/10">
      {label}
    </kbd>
    <span className="text-slate-500">{description}</span>
  </div>
);
