import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardNav';

interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
    isOpen,
    onClose,
}) => {
    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md animate-in zoom-in-95 fade-in duration-150">
                <div className="mx-4 bg-[#0a0505]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-white/5">
                        <div className="flex items-center gap-2">
                            <Keyboard size={20} className="text-red-400" />
                            <h2 className="text-lg font-bold text-white">Keyboard Shortcuts</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Shortcuts List */}
                    <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
                        {KEYBOARD_SHORTCUTS.map((shortcut, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
                            >
                                <span className="text-sm text-slate-300">{shortcut.description}</span>
                                <kbd className="px-2 py-1 bg-white/10 border border-white/10 rounded text-xs font-mono text-white/80">
                                    {shortcut.key}
                                </kbd>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/5 text-center">
                        <p className="text-xs text-slate-500">
                            Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono">?</kbd> anytime to show this menu
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default KeyboardShortcutsModal;
