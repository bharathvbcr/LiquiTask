import React, { useState, useRef, useEffect } from 'react';
import { Plus, Sparkles, Calendar, Flag, X } from 'lucide-react';

interface QuickAddBarProps {
    onAddTask: (title: string, options?: { priority?: string; dueDate?: Date }) => void;
    isVisible: boolean;
    onClose: () => void;
}

// Simple natural language parsing for quick task entry
function parseQuickTask(input: string): { title: string; priority?: string; dueDate?: Date } {
    let title = input;
    let priority: string | undefined;
    let dueDate: Date | undefined;

    // Parse priority markers
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

    // Parse due date patterns
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

    return { title: title.trim(), priority, dueDate };
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
                                <Hint label="@tomorrow" description="Tomorrow" />
                                <Hint label="@1/15" description="MM/DD" />
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
