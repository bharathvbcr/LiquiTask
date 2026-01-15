import React from 'react';
import { Plus } from 'lucide-react';

interface LiquidButtonProps {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  title?: string;
}

export const LiquidButton: React.FC<LiquidButtonProps> = ({ label, onClick, icon, title }) => {
  return (
    <button
      onClick={onClick}
      className="group relative px-6 py-3 rounded-2xl font-bold text-white transition-all duration-300 transform active:scale-95 overflow-hidden"
      title={title}
    >
      {/* Base Liquid Layer */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-700 to-red-900 rounded-2xl border border-red-500/50 shadow-[0_0_15px_rgba(220,38,38,0.4)] z-0 transition-all duration-300 group-hover:shadow-[0_0_30px_rgba(255,30,30,0.6)]"></div>
      
      {/* Viscous Ripple Overlay */}
      <div className="absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
         <div className="absolute inset-0 bg-red-600/30 mix-blend-overlay animate-ripple rounded-2xl"></div>
      </div>

      {/* Shine Effect */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/20 to-transparent rounded-t-2xl z-0 pointer-events-none opacity-50"></div>
      
      {/* Bottom Highlight */}
      <div className="absolute bottom-0 left-0 w-full h-1/3 bg-gradient-to-t from-black/20 to-transparent rounded-b-2xl z-0 pointer-events-none"></div>

      {/* Content */}
      <div className="relative z-10 flex items-center gap-2 drop-shadow-md">
        {icon || <Plus size={20} className="text-red-100" />}
        <span className="tracking-wide text-sm">{label}</span>
      </div>
    </button>
  );
};