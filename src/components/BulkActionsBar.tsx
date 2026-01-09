import React, { useState } from 'react';
import { Trash2, MoveRight, UserPlus, X, CheckSquare, Square, Flag, Calendar, Tag } from 'lucide-react';
import { BoardColumn, PriorityDefinition } from '../../types';

interface BulkActionsBarProps {
    selectedCount: number;
    columns: BoardColumn[];
    assignees: string[];
    priorities: PriorityDefinition[];
    availableTags: string[];
    onMove: (columnId: string) => void;
    onAssign: (assignee: string) => void;
    onDelete: () => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    isAllSelected: boolean;
    onSetPriority: (priorityId: string) => void;
    onSetDueDate: (date: Date | null) => void;
    onAddTag: (tag: string) => void;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
    selectedCount,
    columns,
    assignees,
    priorities,
    availableTags,
    onMove,
    onAssign,
    onDelete,
    onSelectAll,
    onSelectNone,
    isAllSelected,
    onSetPriority,
    onSetDueDate,
    onAddTag,
}) => {
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [newTag, setNewTag] = useState('');

    if (selectedCount === 0) return null;

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const date = e.target.value ? new Date(e.target.value) : null;
        onSetDueDate(date);
        setShowDatePicker(false);
    };

    const handleAddTag = (tag: string) => {
        if (tag.trim()) {
            onAddTag(tag.trim());
            setNewTag('');
        }
    };

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
            <div className="flex items-center gap-3 px-4 py-3 bg-[#1a0a0a]/95 backdrop-blur-xl border border-red-500/20 rounded-2xl shadow-2xl shadow-black/50">
                {/* Selection Info */}
                <div className="flex items-center gap-3 pr-3 border-r border-white/10">
                    <button
                        onClick={isAllSelected ? onSelectNone : onSelectAll}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        title={isAllSelected ? 'Deselect all' : 'Select all'}
                    >
                        {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span className="text-sm font-bold text-white">
                        {selectedCount} selected
                    </span>
                </div>

                {/* Move Action */}
                <div className="relative group">
                    <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <MoveRight size={16} />
                        Move to
                    </button>

                    {/* Dropdown */}
                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block">
                        <div className="bg-[#1a0a0a] border border-white/10 rounded-xl p-1 shadow-xl min-w-[150px]">
                            {columns.map(col => (
                                <button
                                    key={col.id}
                                    onClick={() => onMove(col.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                                >
                                    <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: col.color }}
                                    />
                                    {col.title}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Priority Action */}
                <div className="relative group">
                    <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <Flag size={16} />
                        Priority
                    </button>

                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block">
                        <div className="bg-[#1a0a0a] border border-white/10 rounded-xl p-1 shadow-xl min-w-[120px]">
                            {priorities.map(priority => (
                                <button
                                    key={priority.id}
                                    onClick={() => onSetPriority(priority.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 rounded-lg transition-colors text-left"
                                    style={{ color: priority.color }}
                                >
                                    <Flag size={12} />
                                    {priority.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Due Date Action */}
                <div className="relative">
                    <button
                        onClick={() => setShowDatePicker(!showDatePicker)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <Calendar size={16} />
                        Due Date
                    </button>

                    {showDatePicker && (
                        <div className="absolute bottom-full left-0 mb-2 bg-[#1a0a0a] border border-white/10 rounded-xl p-3 shadow-xl">
                            <input
                                type="date"
                                onChange={handleDateChange}
                                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 [color-scheme:dark] focus:border-red-500/50 outline-none"
                            />
                            <button
                                onClick={() => { onSetDueDate(null); setShowDatePicker(false); }}
                                className="w-full mt-2 px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                                Clear Due Date
                            </button>
                        </div>
                    )}
                </div>

                {/* Tag Action */}
                <div className="relative group">
                    <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <Tag size={16} />
                        Add Tag
                    </button>

                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block">
                        <div className="bg-[#1a0a0a] border border-white/10 rounded-xl p-2 shadow-xl min-w-[180px]">
                            <input
                                type="text"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddTag(newTag)}
                                placeholder="New tag..."
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-slate-300 placeholder-slate-500 focus:border-red-500/50 outline-none mb-2"
                            />
                            {availableTags.length > 0 && (
                                <div className="max-h-[120px] overflow-y-auto">
                                    {availableTags.slice(0, 10).map(tag => (
                                        <button
                                            key={tag}
                                            onClick={() => onAddTag(tag)}
                                            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                                        >
                                            <Tag size={10} />
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Assign Action */}
                {assignees.length > 0 && (
                    <div className="relative group">
                        <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                            <UserPlus size={16} />
                            Assign
                        </button>

                        <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block">
                            <div className="bg-[#1a0a0a] border border-white/10 rounded-xl p-1 shadow-xl min-w-[150px] max-h-[200px] overflow-y-auto">
                                <button
                                    onClick={() => onAssign('')}
                                    className="w-full px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left italic"
                                >
                                    Unassign
                                </button>
                                {assignees.map(assignee => (
                                    <button
                                        key={assignee}
                                        onClick={() => onAssign(assignee)}
                                        className="w-full px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                                    >
                                        {assignee}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Divider */}
                <div className="w-px h-6 bg-white/10" />

                {/* Delete Action */}
                <button
                    onClick={onDelete}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                    <Trash2 size={16} />
                    Delete
                </button>

                {/* Close Button */}
                <button
                    onClick={onSelectNone}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Clear selection"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};

export default BulkActionsBar;

