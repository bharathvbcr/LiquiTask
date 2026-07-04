import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import type { ToastMessage } from "../types";

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
      case "success":
        return "bg-[#050a05]/95 border-emerald-500/30 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]";
      case "error":
        return "bg-[#0a0505]/95 border-red-500/30 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.15)]";
      case "warning":
        return "bg-[#0a0803]/95 border-amber-500/30 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.15)]";
      default:
        return "bg-[#0a0505]/95 border-white/15 text-slate-200 shadow-[0_0_20px_rgba(0,0,0,0.35)]";
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case "success":
        return <CheckCircle size={18} className="text-emerald-400" />;
      case "error":
        return <AlertCircle size={18} className="text-red-400" />;
      case "warning":
        return <AlertTriangle size={18} className="text-amber-400" />;
      default:
        return <Info size={18} className="text-slate-300" />;
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
      flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md mb-3 
      transition-all duration-500 animate-in slide-in-from-right-full fade-in
      hover:scale-[1.02] cursor-default pointer-events-auto max-w-sm
      ${getStyles()}
    `}
    >
      {getIcon()}
      <span className="text-sm font-medium flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss notification"
        className="p-1 hover:bg-white/10 rounded-full transition-colors opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <X size={14} />
      </button>
    </div>
  );
};
