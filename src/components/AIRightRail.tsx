import React from 'react';
import { Sparkles } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface AIRightRailProps {
  isOpen: boolean;
  onToggle: () => void;
  isLoading?: boolean;
}

/**
 * AIRightRail — mirrors the left Sidebar's "edge-origin" architecture exactly.
 *
 * Left sidebar:
 *   <aside fixed left-4 w-20 overflow-visible>
 *     <div w-80 rounded-[28px] paddingLeft=240px translateX(-240px)>
 *       → left 240px is off the left screen edge (clipped naturally)
 *       → right 80px is the visible rail
 *
 * Right rail (mirror):
 *   <aside fixed right-0 w-14 overflow-visible>
 *     <div w-80 rounded-l-[28px] paddingRight=264px>
 *       → right 264px overflows the screen right edge (clipped naturally)
 *       → left 56px is the visible rail
 *       → no translateX needed — the panel naturally starts at the parent's left edge
 */
const PANEL_W = 320; // w-80
const RAIL_W  =  56; // w-14
const OVERFLOW = PANEL_W - RAIL_W; // 264px goes off right side of screen

export const AIRightRail: React.FC<AIRightRailProps> = ({ isOpen, onToggle, isLoading: _ }) => {
  return (
    <aside
      className={`
        fixed right-0 top-14 bottom-0 w-14
        overflow-visible z-[55]
        transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${isOpen ? 'opacity-0 pointer-events-none translate-x-4' : 'opacity-100 pointer-events-auto'}
      `}
    >
      {/*
        320px-wide panel. It starts at the parent's left edge (screen_width - 56px from left)
        and extends 264px off the right screen edge — those corners disappear naturally.
        Only rounded-l corners are visible.
      */}
      <div
        className="flex h-full flex-col items-center py-10 rounded-l-[28px] liquid-glass border border-l border-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)]"
        style={{
          width: `${PANEL_W}px`,
          paddingRight: `${OVERFLOW}px`,
        }}
      >
        {/* Single AI toggle */}
        <Tooltip content="Open AI Assistant" position="left">
          <button
            onClick={onToggle}
            className="relative p-3 rounded-xl transition-all duration-300 group text-slate-400 hover:text-slate-100 hover:bg-white/5"
            aria-label="Open AI Assistant"
          >
            <Sparkles
              size={18}
              className="group-hover:rotate-12 transition-transform duration-500"
            />

            {/* Live indicator */}
            <div className="absolute top-1 right-1 w-2 h-2 bg-red-400 rounded-full border-2 border-slate-900 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />

            {/* Hover glow */}
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 blur-sm transition-opacity duration-500" />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
};
