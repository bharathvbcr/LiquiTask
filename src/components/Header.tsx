import React, { useState, useEffect, useMemo } from 'react';
import { Search, Bell, Filter, Calendar, Tag, User, Undo2, Plus } from 'lucide-react';
import { Button } from './common/Button';
import { Input } from './common/Input';
import { FilterState } from '../../types';
import logo from '../assets/logo.png';

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
    // Notification permission state
    const [notificationPermission, setNotificationPermission] = useState<'granted' | 'denied' | 'default'>('default');

    useEffect(() => {
        if ('Notification' in window) {
            setNotificationPermission(Notification.permission as 'granted' | 'denied' | 'default');
        }
    }, []);

    // Helper to check if filters are active (basic filters only, no advanced filter group)
    const hasActiveFilters = useMemo(() => {
        return !!(
            filters.assignee ||
            filters.tags ||
            (filters.dateRange && filters.startDate && filters.endDate)
        );
    }, [filters]);



    return (
        <header
            className="px-8 py-6 flex flex-col gap-4 sticky top-4 z-30 mx-6 mt-4 rounded-3xl liquid-glass"
            role="banner"
        >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <img src={logo} alt="LiquiTask" className="w-8 h-8 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" title="LiquiTask - Task Management Dashboard" />
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
                </div>

                <div className="flex items-center gap-6">
                    <div
                        className="hidden lg:flex items-center gap-3 bg-black/20 border border-white/5 px-4 py-2.5 rounded-2xl text-slate-400 w-64 focus-within:border-red-500/50 focus-within:ring-1 focus-within:ring-red-500/20 transition-all shadow-inner"
                        role="search"
                        title="Search tasks and fields - Press / to focus, Enter to search"
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

                    <div className="flex items-center gap-2 border-r border-white/5 pr-6 mr-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onUndo}
                            disabled={!canUndo}
                            title={canUndo ? "Undo last action (Ctrl+Z)" : "No actions to undo"}
                            className="!p-2 rounded-full"
                        >
                            <Undo2 size={20} />
                        </Button>

                        <Button
                            variant={isFilterOpen ? 'danger' : 'ghost'}
                            size="sm"
                            onClick={onToggleFilter}
                            title={isFilterOpen ? "Close Filters" : "Open Filters"}
                            className="!p-2 rounded-full"
                        >
                            <Filter size={20} />
                            {hasActiveFilters && (
                                <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0a0a0a]"></span>
                            )}
                        </Button>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                import('../services/notificationService').then(({ notificationService }) => {
                                    notificationService.requestPermission().then((granted) => {
                                        if (granted) {
                                            setNotificationPermission('granted');
                                            notificationService.show({
                                                title: 'Notifications Enabled',
                                                body: 'You will now receive task reminders.'
                                            });
                                        } else {
                                            setNotificationPermission('denied');
                                        }
                                    });
                                });
                            }}
                            title="Notifications"
                            className={`!p-2 rounded-full ${notificationPermission !== 'granted' ? 'opacity-80' : ''}`}
                        >
                            <Bell size={20} className={notificationPermission === 'granted' ? 'text-red-400' : ''} />
                        </Button>
                    </div>

                    <Button
                        variant="primary"
                        onClick={onNewTask}
                        icon={<Plus size={20} className="text-red-100" />}
                        title="New Task (C)"
                    >
                        New Task
                    </Button>
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
                        <Input
                            id="filter-assignee"
                            label="Assignee"
                            icon={<User size={10} aria-hidden="true" />}
                            size="sm"
                            value={filters.assignee}
                            onChange={(e) => onFiltersChange({ ...filters, assignee: e.target.value })}
                            className="w-32"
                            placeholder="Name..."
                        />
                        <Input
                            id="filter-tags"
                            label="Tag"
                            icon={<Tag size={10} aria-hidden="true" />}
                            size="sm"
                            value={filters.tags}
                            onChange={(e) => onFiltersChange({ ...filters, tags: e.target.value })}
                            className="w-32"
                            placeholder="Category..."
                        />
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
                                        <Input
                                            type="date"
                                            value={filters.startDate}
                                            onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })}
                                            size="sm"
                                            className="w-auto"
                                            aria-label="Start date"
                                        />
                                        <span className="text-slate-500">-</span>
                                        <Input
                                            type="date"
                                            value={filters.endDate}
                                            onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })}
                                            size="sm"
                                            className="w-auto"
                                            aria-label="End date"
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                        <Button
                            onClick={() => onFiltersChange({ assignee: '', dateRange: null, startDate: '', endDate: '', tags: '' })}
                            variant="ghost"
                            size="sm"
                            className="ml-auto text-xs text-red-400 hover:text-white underline p-0 h-auto hover:bg-transparent"
                            aria-label="Clear all filters"
                        >
                            Clear Filters
                        </Button>
                    </div>
                </div>
            )}
        </header>
    );
};

export default Header;
