import React from 'react';
import { Keyboard } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardNav';
import { Modal } from './common/Modal';

interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
    isOpen,
    onClose,
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Keyboard Shortcuts"
            icon={<Keyboard size={20} />}
            size="md"
        >
            <div className="space-y-2">
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

            <div className="mt-6 pt-4 border-t border-white/5 text-center">
                <p className="text-xs text-slate-500">
                    Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono">?</kbd> anytime to show this menu
                </p>
            </div>
        </Modal>
    );
};

export default KeyboardShortcutsModal;
