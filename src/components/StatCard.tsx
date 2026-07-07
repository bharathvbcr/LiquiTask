import type React from "react";

export type StatCardAccent = "slate" | "red" | "amber" | "emerald";

const ACCENT_STYLES: Record<
  StatCardAccent,
  { label: string; hoverBorder: string; icon: string; overlay: string; footnote: string }
> = {
  slate: {
    label: "text-slate-400",
    hoverBorder: "hover:border-white/20",
    icon: "text-slate-400",
    overlay: "bg-white/5",
    footnote: "text-slate-300",
  },
  red: {
    label: "text-red-300",
    hoverBorder: "hover:border-red-500/30",
    icon: "text-red-500",
    overlay: "bg-red-500/5",
    footnote: "text-red-400",
  },
  amber: {
    label: "text-slate-400",
    hoverBorder: "hover:border-amber-500/30",
    icon: "text-amber-500",
    overlay: "bg-amber-500/5",
    footnote: "text-amber-400",
  },
  emerald: {
    label: "text-emerald-300",
    hoverBorder: "hover:border-emerald-500/30",
    icon: "text-emerald-500",
    overlay: "bg-emerald-500/5",
    footnote: "text-emerald-400",
  },
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  footnote?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: StatCardAccent;
  className?: string;
}

/** Dashboard stat panel: uppercase eyebrow, big gradient number, footnote, and a faint background glyph. */
export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  footnote,
  icon,
  accent = "slate",
  className = "",
}) => {
  const a = ACCENT_STYLES[accent];
  return (
    <div
      className={`liquid-glass p-6 relative overflow-hidden group border border-transparent transition-all duration-500 ${a.hoverBorder} ${className}`}
    >
      {icon && (
        <div
          className={`absolute top-0 right-0 p-4 opacity-10 group-hover:scale-125 transition-transform duration-700 ease-out ${a.icon}`}
        >
          {icon}
        </div>
      )}
      <div
        className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${a.overlay}`}
      />
      <p className={`text-xs uppercase tracking-widest font-bold relative z-10 ${a.label}`}>{label}</p>
      <h3 className="stat-number text-4xl mt-2 relative z-10">{value}</h3>
      {footnote && <p className={`mt-4 text-xs font-medium relative z-10 ${a.footnote}`}>{footnote}</p>}
    </div>
  );
};

export default StatCard;
