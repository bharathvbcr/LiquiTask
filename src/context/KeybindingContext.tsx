import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import storageService from '../services/storageService';
import { DEFAULT_KEYBINDINGS, KeybindingMap } from '../constants/keybindings';

interface KeybindingContextValue {
    keybindings: KeybindingMap;
    updateKeybinding: (actionId: string, keys: string[]) => void;
    resetKeybindings: () => void;
    matches: (actionId: string, event: KeyboardEvent | React.KeyboardEvent) => boolean;
    getLabel: (actionId: string) => string;
}

const STORAGE_KEY = 'liquitask-keybindings';

const KeybindingContext = createContext<KeybindingContextValue | null>(null);

export const KeybindingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [keybindings, setKeybindings] = useState<KeybindingMap>(DEFAULT_KEYBINDINGS);

    // Load from storage
    useEffect(() => {
        const stored = storageService.get<KeybindingMap>(STORAGE_KEY, DEFAULT_KEYBINDINGS);
        // Merge with defaults to ensure new actions exist
        setKeybindings({ ...DEFAULT_KEYBINDINGS, ...stored });
    }, []);

    const updateKeybinding = useCallback((actionId: string, keys: string[]) => {
        setKeybindings(prev => {
            const next = { ...prev, [actionId]: keys };
            storageService.set(STORAGE_KEY, next);
            return next;
        });
    }, []);

    const resetKeybindings = useCallback(() => {
        setKeybindings(DEFAULT_KEYBINDINGS);
        storageService.set(STORAGE_KEY, DEFAULT_KEYBINDINGS);
    }, []);

    const matches = useCallback((actionId: string, event: KeyboardEvent | React.KeyboardEvent): boolean => {
        const keys = keybindings[actionId];
        if (!keys) return false;

        return keys.some(combo => {
            const parts = combo.toLowerCase().split('+');
            const mainKey = parts[parts.length - 1];
            
            // Check modifiers
            const meta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
            const ctrl = parts.includes('ctrl') || parts.includes('control');
            const shift = parts.includes('shift');
            const alt = parts.includes('alt') || parts.includes('opt');

            if (meta && !(event.metaKey)) return false;
            if (ctrl && !(event.ctrlKey)) return false;
            if (shift && !(event.shiftKey)) return false;
            if (alt && !(event.altKey)) return false;

            // Check main key
            const eventKey = event.key.toLowerCase();
            return eventKey === mainKey;
        });
    }, [keybindings]);

    const getLabel = useCallback((actionId: string) => {
        const keys = keybindings[actionId];
        if (!keys || keys.length === 0) return '';
        return keys[0]; // Return primary shortcut
    }, [keybindings]);

    return (
        <KeybindingContext.Provider value={{ keybindings, updateKeybinding, resetKeybindings, matches, getLabel }}>
            {children}
        </KeybindingContext.Provider>
    );
};

export const useKeybinding = () => {
    const context = useContext(KeybindingContext);
    if (!context) throw new Error('useKeybinding must be used within KeybindingProvider');
    return context;
};
