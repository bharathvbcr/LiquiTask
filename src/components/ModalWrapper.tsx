import { X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { acquireScrollLock, releaseScrollLock } from "../utils/scrollLock";
import { Tooltip } from "./Tooltip";

interface ModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  icon?: React.ReactNode;
  logo?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "full";
}

export const ModalWrapper: React.FC<ModalWrapperProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  icon,
  logo,
  size = "lg",
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen, modalRef);

  // Close on Escape key and lock body scroll while open
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEsc);
      acquireScrollLock();
    }
    return () => {
      window.removeEventListener("keydown", handleEsc);
      if (isOpen) releaseScrollLock();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "3xl": "max-w-3xl",
    "4xl": "max-w-4xl",
    "5xl": "max-w-5xl",
    "6xl": "max-w-6xl",
    full: "max-w-full mx-4",
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#020000]/80 backdrop-blur-md transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      ></div>

      {/* Modal Content */}
      <div
        ref={modalRef}
        data-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative w-full ${sizeClasses[size]} liquid-glass flex flex-col transform transition-all animate-in zoom-in-95 duration-300 border border-red-500/20 shadow-[0_0_50px_rgba(0,0,0,0.9)] max-h-[85vh]`}
      >
        {/* Decorative Header Glow */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 via-red-500 to-red-900 shadow-[0_0_20px_rgba(220,38,38,0.8)] z-20"></div>
        <div className="absolute top-1 right-0 w-32 h-32 bg-red-600/10 rounded-full blur-[40px] pointer-events-none z-0"></div>

        <div className="p-8 pb-4 relative z-10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {logo && (
                <img
                  src={logo}
                  alt="LiquiTask"
                  className="w-6 h-6 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]"
                />
              )}
              {icon && (
                <div className="p-2.5 bg-red-500/10 rounded-xl border border-red-500/30 text-red-400 shadow-[0_0_15px_rgba(220,38,38,0.2)]">
                  {icon}
                </div>
              )}
              <div>
                <h3 id="modal-title" className="text-2xl font-bold text-white tracking-tight text-glow">{title}</h3>
              </div>
            </div>
            <Tooltip content="Close" position="top">
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"
                aria-label="Close modal"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col relative z-10">
          <div className="flex-1 overflow-y-auto p-8 pt-0 custom-scrollbar">{children}</div>
          {footer ? (
            <div className="shrink-0 border-t border-white/10 bg-[#0a0505]/90 px-8 py-4 backdrop-blur-md">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
