import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, X, ArrowRight, Settings, LayoutGrid, FolderOpen, FileText, Keyboard, Plus, Flag, Calendar, Tag, Clock } from 'lucide-react';
import { parseQuickTask, ParsedTask } from '../utils/taskParser';

type CommandActionKeywordSet = string[];

export interface CommandAction {
    id: string;
    label: string;
    description?: string;
    category: 'task' | 'project' | 'view' | 'action';
    icon?: React.ReactNode;
    shortcut?: string;
    keywords?: CommandActionKeywordSet;
    aliases?: CommandActionKeywordSet;
    action: () => void;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    actions: CommandAction[];
    onCreateTask?: (task: ParsedTask) => void;
    commandUsageHistory?: Record<string, number>;
    onActionExecuted?: (actionId: string) => void;
}

type ActionWithScore = { action: CommandAction; score: number };

const RECENCY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function fuzzyMatch(text: string, query: string): { matches: boolean; score: number } {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();

    if (!queryLower) {
        return { matches: true, score: 0 };
    }

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

const normalizeText = (value: string) => value.toLowerCase().trim();

const getRecencyScore = (lastUsed?: number) => {
    if (!lastUsed) return 0;
    const age = Date.now() - lastUsed;
    if (age <= 0) return 100;
    if (age >= RECENCY_WINDOW_MS) return 0;
    return ((RECENCY_WINDOW_MS - age) / RECENCY_WINDOW_MS) * 100;
};

const getActionSearchText = (action: CommandAction) => {
    const pieces = [
        action.label,
        action.description ?? '',
        action.id,
        action.shortcut ?? '',
        ...(action.keywords ?? []),
        ...(action.aliases ?? []),
        action.category,
    ];

    return pieces
        .filter(Boolean)
        .map((value) => normalizeText(String(value)))
        .join(' ');
};

const buildActionScores = (
    actions: CommandAction[],
    query: string,
    usageHistory: Record<string, number>,
) => {
    const trimmedQuery = normalizeText(query);
    if (!trimmedQuery) {
        return actions.map((action) => ({
            action,
            score: getRecencyScore(usageHistory[action.id]),
        }));
    }

    const tokens = trimmedQuery
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);

    return actions
        .map((action) => {
            const actionText = getActionSearchText(action);
            let cumulativeScore = 0;

            for (const token of tokens) {
                const result = fuzzyMatch(actionText, token);
                if (!result.matches) {
                    return null;
                }
                cumulativeScore += result.score;
            }

            const averageMatch = cumulativeScore / tokens.length;
            return {
                action,
                score: averageMatch + getRecencyScore(usageHistory[action.id]),
            };
        })
        .filter((candidate): candidate is ActionWithScore => candidate !== null);
};

const sortCandidates = (candidates: ActionWithScore[], hasQuery: boolean) => {
    return [...candidates].sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }

        if (!hasQuery) {
            return a.action.label.localeCompare(b.action.label);
        }

        return 0;
    });
};

const groupByCategory = (actions: CommandAction[]) => {
    const groups: Record<'task' | 'project' | 'view' | 'action', CommandAction[]> = {
        task: [],
        project: [],
        view: [],
        action: [],
    };

    actions.forEach((action) => {
        if (groups[action.category]) {
            groups[action.category].push(action);
        }
    });

    return groups;
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    isOpen,
    onClose,
    actions,
    onCreateTask,
    commandUsageHistory = {},
    onActionExecuted,
}) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Parse query for task creation
    const parsedTask = useMemo(() => {
        if (!query.trim()) return null;
        return parseQuickTask(query);
    }, [query]);

    // Filter and sort actions based on query
    const filteredActions = useMemo(() => {
        const quickCreateResult = query.trim() && onCreateTask && parsedTask?.title
            ? [{
                id: 'quick-create-task',
                label: `Create: ${parsedTask.title}`,
                category: 'task' as const,
                description: `Priority: ${parsedTask.priority || 'Default'} • Due: ${parsedTask.dueDate?.toLocaleDateString() || 'None'} • Project: ${parsedTask.projectName || 'Current'}`,
                icon: <Plus size={16} className="text-emerald-400" />,
                shortcut: '↵',
                keywords: ['create', 'new', 'task', 'todo', 'add', parsedTask.title],
                aliases: [parsedTask.projectName || 'task'],
                action: () => {
                    if (parsedTask) onCreateTask(parsedTask);
                },
            }]
            : [];

        const scored = buildActionScores(actions, query, commandUsageHistory);
        const sortedCandidates = sortCandidates(scored, Boolean(query.trim()));

        return [
            ...quickCreateResult,
            ...sortedCandidates.map(candidate => candidate.action),
        ];
    }, [actions, commandUsageHistory, onCreateTask, parsedTask, query]);

    const groupedActions = useMemo(
        () => groupByCategory(filteredActions),
        [filteredActions],
    );

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

    const executeAction = useCallback((action: CommandAction) => {
        action.action();
        onActionExecuted?.(action.id);
        onClose();
    }, [onActionExecuted, onClose]);

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
                    executeAction(filteredActions[selectedIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [executeAction, filteredActions, onClose, selectedIndex]);

    // Reset selection when filtered results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query, filteredActions.length]);

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

    // Helper to render preview badges for the creation action
    const renderTaskPreview = () => {
        if (!parsedTask || query.trim() === '') return null;
        
        return (
            <div className="flex flex-wrap gap-2 mt-1">
                {parsedTask.priority && (
                    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${
                        parsedTask.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                        parsedTask.priority === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-emerald-500/20 text-emerald-400'
                    }`}>
                        <Flag size={10} /> {parsedTask.priority}
                    </span>
                )}
                {parsedTask.dueDate && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                        <Calendar size={10} /> {parsedTask.dueDate.toLocaleDateString()}
                    </span>
                )}
                {parsedTask.projectName && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                        <FolderOpen size={10} /> {parsedTask.projectName}
                    </span>
                )}
                {parsedTask.timeEstimate && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400">
                        <Clock size={10} /> {parsedTask.timeEstimate}m
                    </span>
                )}
                {parsedTask.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                        <Tag size={10} /> {tag}
                    </span>
                ))}
            </div>
        );
    };

    let globalIndex = -1;

    return (
        <>
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                onClick={onClose}
            />

            <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-xl z-50 animate-in zoom-in-95 fade-in duration-150">
                <div className="mx-4 bg-[#0a0505]/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
                    <div className="flex items-center gap-3 p-4 border-b border-white/5">
                        <Search size={20} className="text-red-400 shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type a command or create task (e.g. 'Buy milk !high @tomorrow')..."
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

                    <div ref={listRef} className="max-h-[50vh] overflow-y-auto custom-scrollbar">
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
                                            const isCreateAction = action.id === 'quick-create-task';

                                            return (
                                                <button
                                                    key={action.id}
                                                    data-index={globalIndex}
                                                    onClick={() => executeAction(action)}
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
                                                        {action.description && !isCreateAction && (
                                                            <div className="text-xs text-slate-500 truncate">
                                                                {action.description}
                                                            </div>
                                                        )}
                                                        {isCreateAction && renderTaskPreview()}
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
