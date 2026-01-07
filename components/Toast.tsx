import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, 5000); // Auto dismiss
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const getStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-[#050a05]/95 border-emerald-500/30 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]';
      case 'error':
        return 'bg-[#0a0505]/95 border-red-500/30 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.15)]';
      default:
        return 'bg-[#05050a]/95 border-blue-500/30 text-blue-200 shadow-[0_0_20px_rgba(59,130,246,0.15)]';
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success': return <CheckCircle size={18} className="text-emerald-400" />;
      case 'error': return <AlertCircle size={18} className="text-red-400" />;
      default: return <Info size={18} className="text-blue-400" />;
    }
  };

  return (
    <div className={`
      flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md mb-3 
      transition-all duration-500 animate-in slide-in-from-right-full fade-in
      hover:scale-[1.02] cursor-default pointer-events-auto
      ${getStyles()}
    `}>
      {getIcon()}
      <span className="text-sm font-medium">{toast.message}</span>
      <button 
        onClick={() => onClose(toast.id)}
        className="ml-2 p-1 hover:bg-white/10 rounded-full transition-colors opacity-70 hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
};