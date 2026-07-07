import { Plus } from "lucide-react";
import type React from "react";
import { Tooltip } from "./Tooltip";

interface LiquidButtonProps {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  title?: string;
}

export const LiquidButton: React.FC<LiquidButtonProps> = ({ label, onClick, icon, title }) => {
  return (
    <Tooltip content={title} position="top">
      <button
        type="button"
        onClick={onClick}
        className="liquid-button group relative overflow-hidden rounded-2xl px-6 py-3 text-sm font-bold text-white"
      >
        <div className="liquid-btn-waves absolute inset-0 z-0 overflow-hidden rounded-[inherit] opacity-35 transition-opacity duration-500 group-hover:opacity-100">
          <div className="liquid-btn-wave liquid-btn-wave--1 rounded-[inherit]" aria-hidden="true" />
          <div className="liquid-btn-wave liquid-btn-wave--2 rounded-[inherit]" aria-hidden="true" />
          <div className="liquid-btn-wave liquid-btn-wave--3 rounded-[inherit]" aria-hidden="true" />
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-gradient-to-b from-white/12 via-transparent to-black/10"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center gap-2 drop-shadow-sm">
          {icon || <Plus size={20} className="text-red-100" />}
          <span className="tracking-wide">{label}</span>
        </div>
      </button>
    </Tooltip>
  );
};
