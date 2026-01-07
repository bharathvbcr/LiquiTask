import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export const ModalWrapper: React.FC<ModalWrapperProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  icon
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-[#020000]/80 backdrop-blur-md transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      ></div>

      {/* Modal Content */}
      <div className="relative w-full max-w-lg liquid-glass flex flex-col transform transition-all animate-in zoom-in-95 duration-300 border border-red-500/20 shadow-[0_0_50px_rgba(0,0,0,0.9)] max-h-[85vh]">
        
        {/* Decorative Header Glow */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 via-red-500 to-red-900 shadow-[0_0_20px_rgba(220,38,38,0.8)] z-20"></div>
        <div className="absolute top-1 right-0 w-32 h-32 bg-red-600/10 rounded-full blur-[40px] pointer-events-none z-0"></div>

        <div className="p-8 pb-4 relative z-10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {icon && (
                <div className="p-2.5 bg-red-500/10 rounded-xl border border-red-500/30 text-red-400 shadow-[0_0_15px_rgba(220,38,38,0.2)]">
                  {icon}
                </div>
              )}
              <div>
                <h3 className="text-2xl font-bold text-white tracking-tight text-glow">{title}</h3>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-8 pt-0 overflow-y-auto custom-scrollbar relative z-10">
          {children}
        </div>
      </div>
    </div>
  );
};