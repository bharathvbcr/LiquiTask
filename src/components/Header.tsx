import React from 'react';
import { Search, Bell, Filter, Calendar, Tag, User, Undo2 } from 'lucide-react';
import { LiquidButton } from '../../components/LiquidButton';
import { FilterState } from '../../types';

interface HeaderProps {
    currentView: 'project' | 'dashboard';
    activeProjectName: string;
    parentProjectName?: string;
    currentProjectTaskCount: number;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    searchInputRef: React.RefObject<HTMLInputElement>;
    isFilterOpen: boolean;
    onToggleFilter: () => void;
    filters: FilterState;
    onFiltersChange: (filters: FilterState) => void;
    canUndo: boolean;
    onUndo: () => void;
    onNewTask: () => void;
}

export const Header: React.FC<HeaderProps> = ({
    currentView,
    activeProjectName,
    parentProjectName,
    currentProjectTaskCount,
    searchQuery,
    onSearchChange,
    searchInputRef,
    isFilterOpen,
    onToggleFilter,
    filters,
    onFiltersChange,
    canUndo,
    onUndo,
    onNewTask,
}) => {
    return (
        <header
            className="px-8 py-6 flex flex-col gap-4 sticky top-4 z-30 mx-6 mt-4 rounded-3xl liquid-glass"
            role="banner"
        >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-3xl font-bold text-white tracking-tight drop-shadow-md text-glow">
                        {currentView === 'dashboard' ? 'Executive Dashboard' : activeProjectName}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                        {parentProjectName && (
                            <span className="text-xs text-red-300/70 px-1.5 py-0.5 rounded border border-red-500/10 bg-red-500/5">
                                {parentProjectName} /
                            </span>
                        )}
                        <p className="text-slate-400 text-sm font-medium">
                            {currentView === 'dashboard'
                                ? 'Cross-project Overview'
                                : `Project Board • ${currentProjectTaskCount} Active Tasks`}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div
                        className="hidden lg:flex items-center gap-3 bg-black/20 border border-white/5 px-4 py-2.5 rounded-2xl text-slate-400 w-64 focus-within:border-red-500/50 focus-within:ring-1 focus-within:ring-red-500/20 transition-all shadow-inner"
                        role="search"
                    >
                        <Search size={18} aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search tasks & fields... (Cmd+K)"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="bg-transparent border-none outline-none text-sm w-full placeholder-slate-500 text-slate-200"
                            aria-label="Search tasks and fields"
                        />
                    </div>

                    <div className="flex items-center gap-4 border-r border-white/5 pr-6 mr-2">
                        <button
                            onClick={onUndo}
                            disabled={!canUndo}
                            className={`p-2 rounded-full transition-colors relative group ${canUndo ? 'text-slate-400 hover:text-white' : 'text-slate-600 opacity-50 cursor-not-allowed'}`}
                            title="Undo (Ctrl+Z)"
                            aria-label="Undo last action"
                        >
                            <Undo2 size={20} aria-hidden="true" />
                        </button>
                        <button
                            onClick={onToggleFilter}
                            className={`p-2 rounded-full transition-colors relative group ${isFilterOpen ? 'text-red-400 bg-red-500/10' : 'text-slate-400 hover:text-white'}`}
                            title="Filters"
                            aria-label="Toggle filters"
                            aria-expanded={isFilterOpen}
                        >
                            <Filter size={20} aria-hidden="true" />
                        </button>
                        <button
                            className="relative p-2 text-slate-400 hover:text-white transition-colors"
                            aria-label="Notifications"
                            onClick={() => {
                                import('../services/notificationService').then(({ notificationService }) => {
                                    notificationService.requestPermission().then((granted) => {
                                        if (granted) {
                                            notificationService.show({
                                                title: 'Notifications Enabled',
                                                body: 'You will now receive task reminders.'
                                            });
                                        }
                                    });
                                });
                            }}
                        >
                            <Bell size={20} aria-hidden="true" />
                        </button>
                    </div>

                    <LiquidButton
                        label="New Task"
                        onClick={onNewTask}
                    />
                </div>
            </div>

            {/* Collapsible Filter Panel */}
            {isFilterOpen && (
                <div
                    className="pt-4 border-t border-white/5 animate-in slide-in-from-top-2 fade-in"
                    role="region"
                    aria-label="Task filters"
                >
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1.5">
                            <label
                                htmlFor="filter-assignee"
                                className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"
                            >
                                <User size={10} aria-hidden="true" /> Assignee
                            </label>
                            <input
                                id="filter-assignee"
                                type="text"
                                value={filters.assignee}
                                onChange={(e) => onFiltersChange({ ...filters, assignee: e.target.value })}
                                className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 w-32 focus:border-red-500/50 outline-none"
                                placeholder="Name..."
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label
                                htmlFor="filter-tags"
                                className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"
                            >
                                <Tag size={10} aria-hidden="true" /> Tag
                            </label>
                            <input
                                id="filter-tags"
                                type="text"
                                value={filters.tags}
                                onChange={(e) => onFiltersChange({ ...filters, tags: e.target.value })}
                                className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 w-32 focus:border-red-500/50 outline-none"
                                placeholder="Category..."
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label
                                htmlFor="filter-date-range"
                                className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"
                            >
                                <Calendar size={10} aria-hidden="true" /> Date Range
                            </label>
                            <div className="flex items-center gap-2">
                                <select
                                    id="filter-date-range"
                                    value={filters.dateRange || ''}
                                    onChange={(e) => onFiltersChange({ ...filters, dateRange: e.target.value as FilterState['dateRange'] })}
                                    className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:border-red-500/50 outline-none"
                                    aria-label="Select date range type"
                                >
                                    <option value="">None</option>
                                    <option value="due">Due Date</option>
                                    <option value="created">Created Date</option>
                                </select>
                                {filters.dateRange && (
                                    <>
                                        <input
                                            type="date"
                                            value={filters.startDate}
                                            onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })}
                                            className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]"
                                            aria-label="Start date"
                                        />
                                        <span className="text-slate-500">-</span>
                                        <input
                                            type="date"
                                            value={filters.endDate}
                                            onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })}
                                            className="bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 [color-scheme:dark]"
                                            aria-label="End date"
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => onFiltersChange({ assignee: '', dateRange: null, startDate: '', endDate: '', tags: '' })}
                            className="ml-auto text-xs text-red-400 hover:text-white underline"
                            aria-label="Clear all filters"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
};

export default Header;
