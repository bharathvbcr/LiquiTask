import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, X, ArrowRight, Settings, LayoutGrid, FolderOpen, FileText, Keyboard } from 'lucide-react';

export interface CommandAction {
    id: string;
    label: string;
    description?: string;
    category: 'task' | 'project' | 'view' | 'action';
    icon?: React.ReactNode;
    shortcut?: string;
    action: () => void;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    actions: CommandAction[];
}

// Simple fuzzy search implementation
function fuzzyMatch(text: string, query: string): { matches: boolean; score: number } {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();

    // Exact match gets highest score
    if (textLower === queryLower) {
        return { matches: true, score: 100 };
    }

    // Starts with gets high score
    if (textLower.startsWith(queryLower)) {
        return { matches: true, score: 80 };
    }

    // Contains gets medium score
    if (textLower.includes(queryLower)) {
        return { matches: true, score: 60 };
    }

    // Fuzzy matching: check if all query chars appear in order
    let queryIndex = 0;
    let score = 0;

    for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
        if (textLower[i] === queryLower[queryIndex]) {
            score += 1;
            queryIndex++;
        }
    }

    if (queryIndex === queryLower.length) {
        return { matches: true, score: score * 10 / queryLower.length };
    }

    return { matches: false, score: 0 };
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    isOpen,
    onClose,
    actions,
}) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Filter and sort actions based on query
    const filteredActions = useMemo(() => {
        if (!query.trim()) {
            return actions;
        }

        return actions
            .map(action => ({
                action,
                ...fuzzyMatch(action.label + ' ' + (action.description || ''), query),
            }))
            .filter(result => result.matches)
            .sort((a, b) => b.score - a.score)
            .map(result => result.action);
    }, [actions, query]);

    // Group actions by category
    const groupedActions = useMemo((): Record<'task' | 'project' | 'view' | 'action', CommandAction[]> => {
        const groups: Record<'task' | 'project' | 'view' | 'action', CommandAction[]> = {
            task: [],
            project: [],
            view: [],
            action: [],
        };

        filteredActions.forEach(action => {
            groups[action.category].push(action);
        });

        return groups;
    }, [filteredActions]);

    // Reset state when opening/closing
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isOpen]);

    // Keep selected item in view
    useEffect(() => {
        const selectedElement = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
        selectedElement?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    Math.min(prev + 1, filteredActions.length - 1)
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredActions[selectedIndex]) {
                    filteredActions[selectedIndex].action();
                    onClose();
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [filteredActions, selectedIndex, onClose]);

    // Reset selection when filtered results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    if (!isOpen) return null;

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'task': return <FileText size={12} />;
            case 'project': return <FolderOpen size={12} />;
            case 'view': return <LayoutGrid size={12} />;
            case 'action': return <Settings size={12} />;
            default: return null;
        }
    };

    const getCategoryLabel = (category: string) => {
        switch (category) {
            case 'task': return 'Tasks';
            case 'project': return 'Projects';
            case 'view': return 'Views';
            case 'action': return 'Actions';
            default: return category;
        }
    };

    let globalIndex = -1;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                onClick={onClose}
            />

            {/* Command Palette */}
            <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-xl z-50 animate-in zoom-in-95 fade-in duration-150">
                <div className="mx-4 bg-[#0a0505]/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
                    {/* Search Input */}
                    <div className="flex items-center gap-3 p-4 border-b border-white/5">
                        <Search size={20} className="text-red-400 shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type a command or search..."
                            className="flex-1 bg-transparent text-lg text-white placeholder-slate-500 outline-none"
                        />
                        <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 bg-white/5 rounded text-[10px] text-slate-500 font-mono">
                            ESC
                        </kbd>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors sm:hidden"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Results */}
                    <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                        {filteredActions.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                No commands found for &quot;{query}&quot;
                            </div>
                        ) : (
                            Object.entries(groupedActions).map(([category, categoryActions]: [string, CommandAction[]]) => {
                                if (categoryActions.length === 0) return null;

                                return (
                                    <div key={category} className="py-2">
                                        <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                            {getCategoryIcon(category)}
                                            {getCategoryLabel(category)}
                                        </div>
                                        {categoryActions.map((action) => {
                                            globalIndex++;
                                            const isSelected = globalIndex === selectedIndex;

                                            return (
                                                <button
                                                    key={action.id}
                                                    data-index={globalIndex}
                                                    onClick={() => {
                                                        action.action();
                                                        onClose();
                                                    }}
                                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected
                                                        ? 'bg-red-500/10 text-white'
                                                        : 'text-slate-300 hover:bg-white/5'
                                                        }`}
                                                >
                                                    <span className={`shrink-0 ${isSelected ? 'text-red-400' : 'text-slate-500'}`}>
                                                        {action.icon || <ArrowRight size={16} />}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium truncate">{action.label}</div>
                                                        {action.description && (
                                                            <div className="text-xs text-slate-500 truncate">
                                                                {action.description}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {action.shortcut && (
                                                        <kbd className="shrink-0 px-2 py-0.5 bg-white/5 rounded text-[10px] text-slate-500 font-mono">
                                                            {action.shortcut}
                                                        </kbd>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer Hints */}
                    <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 text-[10px] text-slate-500">
                        <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                                <kbd className="px-1 bg-white/5 rounded">↑↓</kbd> navigate
                            </span>
                            <span className="flex items-center gap-1">
                                <kbd className="px-1 bg-white/5 rounded">↵</kbd> select
                            </span>
                        </div>
                        <span className="flex items-center gap-1">
                            <Keyboard size={10} />
                            Press <kbd className="px-1 bg-white/5 rounded">?</kbd> for shortcuts
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
};

export default CommandPalette;
