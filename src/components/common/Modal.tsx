import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    icon?: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
    showCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    icon,
    size = 'lg',
    showCloseButton = true,
}) => {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleEsc);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            window.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const sizeClasses = {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '2xl': 'max-w-2xl',
        'full': 'max-w-[95vw]',
    };

    const modalContent = (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-[#020000]/80 backdrop-blur-md transition-opacity animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div
                className={`
            relative w-full ${sizeClasses[size]} 
            bg-[#0a0a0a]/90 backdrop-blur-xl border border-red-500/20 
            rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.9)] 
            flex flex-col max-h-[90vh] 
            transform transition-all animate-in zoom-in-95 duration-300
            overflow-hidden
        `}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
            >
                {/* Decorative Header Glow */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 via-red-500 to-red-900 shadow-[0_0_20px_rgba(220,38,38,0.8)] z-20" />
                <div className="absolute top-1 right-0 w-32 h-32 bg-red-600/10 rounded-full blur-[40px] pointer-events-none z-0" />

                {/* Header */}
                <div className="p-6 pb-4 relative z-10 shrink-0 flex items-center justify-between border-b border-white/5">
                    <div className="flex items-center gap-3">
                        {icon && (
                            <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/20 text-red-400">
                                {icon}
                            </div>
                        )}
                        <h3 id="modal-title" className="text-xl font-bold text-white tracking-tight">{title}</h3>
                    </div>
                    {showCloseButton && (
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg"
                            aria-label="Close modal"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto custom-scrollbar relative z-10">
                    {children}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};
