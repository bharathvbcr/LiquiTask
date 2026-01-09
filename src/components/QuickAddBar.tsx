import React, { useState, useRef, useEffect } from 'react';
import { Plus, Calendar, Flag, X } from 'lucide-react';

interface QuickAddBarProps {
    onAddTask: (title: string, options?: {
        priority?: string;
        dueDate?: Date;
        projectId?: string;
        timeEstimate?: number;
        tags?: string[];
    }) => void;
    isVisible: boolean;
    onClose: () => void;
    projects?: Array<{ id: string; name: string }>;
}

interface ParsedTask {
    title: string;
    priority?: string;
    dueDate?: Date;
    projectName?: string;
    timeEstimate?: number; // in minutes
    tags: string[];
}

// Enhanced natural language parsing for quick task entry
function parseQuickTask(input: string): ParsedTask {
    let title = input;
    let priority: string | undefined;
    let dueDate: Date | undefined;
    let projectName: string | undefined;
    let timeEstimate: number | undefined;
    const tags: string[] = [];

    // Parse priority markers (!h, !m, !l, !high, !medium, !low)
    if (input.includes('!high') || input.includes('!h')) {
        priority = 'high';
        title = title.replace(/!high|!h/gi, '').trim();
    } else if (input.includes('!medium') || input.includes('!m')) {
        priority = 'medium';
        title = title.replace(/!medium|!m/gi, '').trim();
    } else if (input.includes('!low') || input.includes('!l')) {
        priority = 'low';
        title = title.replace(/!low|!l/gi, '').trim();
    }

    // Parse project (#projectname)
    const projectMatch = input.match(/#([a-zA-Z0-9_-]+)/);
    if (projectMatch) {
        projectName = projectMatch[1];
        title = title.replace(projectMatch[0], '').trim();
    }

    // Parse time estimate (~2h, ~30m, ~1.5h)
    const timeMatch = input.match(/~(\d+(?:\.\d+)?)(h|m)/i);
    if (timeMatch) {
        const value = parseFloat(timeMatch[1]);
        const unit = timeMatch[2].toLowerCase();
        timeEstimate = unit === 'h' ? value * 60 : value; // Convert to minutes
        title = title.replace(timeMatch[0], '').trim();
    }

    // Parse tags (+tag)
    const tagMatches = input.matchAll(/\+([a-zA-Z0-9_-]+)/g);
    for (const match of tagMatches) {
        tags.push(match[1]);
        title = title.replace(match[0], '').trim();
    }

    // Parse due date patterns (@today, @tomorrow, @nextweek, @MM/DD)
    const today = new Date();
    const todayMatch = input.match(/(@today|@tod)/i);
    const tomorrowMatch = input.match(/(@tomorrow|@tom)/i);
    const nextWeekMatch = input.match(/@next\s*week/i);
    const dateMatch = input.match(/@(\d{1,2})\/(\d{1,2})/); // @MM/DD format

    if (todayMatch) {
        dueDate = today;
        title = title.replace(todayMatch[0], '').trim();
    } else if (tomorrowMatch) {
        dueDate = new Date(today);
        dueDate.setDate(today.getDate() + 1);
        title = title.replace(tomorrowMatch[0], '').trim();
    } else if (nextWeekMatch) {
        dueDate = new Date(today);
        dueDate.setDate(today.getDate() + 7);
        title = title.replace(nextWeekMatch[0], '').trim();
    } else if (dateMatch) {
        const month = parseInt(dateMatch[1]) - 1;
        const day = parseInt(dateMatch[2]);
        dueDate = new Date(today.getFullYear(), month, day);
        if (dueDate < today) {
            dueDate.setFullYear(today.getFullYear() + 1);
        }
        title = title.replace(dateMatch[0], '').trim();
    }

    // Clean up any extra whitespace
    title = title.replace(/\s+/g, ' ').trim();

    return { title, priority, dueDate, projectName, timeEstimate, tags };
}

export const QuickAddBar: React.FC<QuickAddBarProps> = ({
    onAddTask,
    isVisible,
    onClose,
}) => {
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isVisible && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isVisible]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isVisible) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, onClose]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        const parsed = parseQuickTask(input);
        if (parsed.title) {
            onAddTask(parsed.title, { priority: parsed.priority, dueDate: parsed.dueDate });
            setInput('');
            onClose();
        }
    };

    const parsed = parseQuickTask(input);

    if (!isVisible) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                onClick={onClose}
            />

            {/* Quick Add Modal */}
            <div className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 animate-in zoom-in-95 fade-in duration-150">
                <form onSubmit={handleSubmit} className="relative">
                    <div className="bg-[#0a0505]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
                        {/* Input */}
                        <div className="flex items-center gap-3 p-4">
                            <Plus size={20} className="text-red-400 shrink-0" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Add task... (e.g., 'Review PR !high @tomorrow')"
                                className="flex-1 bg-transparent text-lg text-white placeholder-slate-500 outline-none"
                            />
                            <button
                                type="button"
                                onClick={onClose}
                                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Preview & Hints */}
                        <div className="px-4 pb-4 border-t border-white/5">
                            {/* Parsed preview */}
                            {input && (
                                <div className="flex items-center gap-3 py-3 border-b border-white/5">
                                    <span className="text-sm text-slate-300">{parsed.title || 'Task name...'}</span>
                                    {parsed.priority && (
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${parsed.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                                            parsed.priority === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                                                'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                            <Flag size={10} className="inline mr-1" />
                                            {parsed.priority}
                                        </span>
                                    )}
                                    {parsed.dueDate && (
                                        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                                            <Calendar size={10} className="inline mr-1" />
                                            {parsed.dueDate.toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Hints */}
                            <div className="pt-3 flex flex-wrap gap-2">
                                <Hint label="!h" description="High priority" />
                                <Hint label="!m" description="Medium" />
                                <Hint label="!l" description="Low" />
                                <Hint label="@today" description="Due today" />
                                <Hint label="@tom" description="Tomorrow" />
                                <Hint label="@1/15" description="MM/DD" />
                                <Hint label="#project" description="Project" />
                                <Hint label="+tag" description="Add tag" />
                                <Hint label="~2h" description="Estimate" />
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </>
    );
};

const Hint: React.FC<{ label: string; description: string }> = ({ label, description }) => (
    <div className="flex items-center gap-1.5 text-[10px]">
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70 font-mono">{label}</kbd>
        <span className="text-slate-500">{description}</span>
    </div>
);

export default QuickAddBar;
