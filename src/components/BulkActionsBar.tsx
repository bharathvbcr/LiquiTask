import React from 'react';
import { Trash2, MoveRight, UserPlus, X, CheckSquare, Square } from 'lucide-react';
import { BoardColumn } from '../../types';

interface BulkActionsBarProps {
    selectedCount: number;
    columns: BoardColumn[];
    assignees: string[];
    onMove: (columnId: string) => void;
    onAssign: (assignee: string) => void;
    onDelete: () => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    isAllSelected: boolean;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
    selectedCount,
    columns,
    assignees,
    onMove,
    onAssign,
    onDelete,
    onSelectAll,
    onSelectNone,
    isAllSelected,
}) => {
    if (selectedCount === 0) return null;

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
