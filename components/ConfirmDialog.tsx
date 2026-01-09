import React from 'react';
import { ModalWrapper } from './ModalWrapper';
import { AlertTriangle, Info, Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'info'
}) => {
    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    const getIcon = () => {
        switch (variant) {
            case 'danger':
                return <Trash2 size={24} className="text-red-400" />;
            case 'warning':
                return <AlertTriangle size={24} className="text-amber-400" />;
            default:
                return <Info size={24} className="text-blue-400" />;
        }
    };

    const getButtonStyles = () => {
        switch (variant) {
            case 'danger':
                return 'bg-red-600 hover:bg-red-500 text-white';
            case 'warning':
                return 'bg-amber-600 hover:bg-amber-500 text-white';
            default:
                return 'bg-blue-600 hover:bg-blue-500 text-white';
        }
    };

    return (
        <ModalWrapper isOpen={isOpen} onClose={onClose}>
            <div className="w-full max-w-md">
                <div className="flex items-start gap-4 mb-6">
                    <div className="p-3 rounded-full bg-white/5 border border-white/10">
                        {getIcon()}
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-semibold text-white mb-2">{title}</h2>
                        <p className="text-slate-400 text-sm leading-relaxed">{message}</p>
                    </div>
                </div>

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-300 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/10"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${getButtonStyles()}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </ModalWrapper>
    );
};
