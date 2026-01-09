import React from 'react';
import { Clock, Star, X, Trash2 } from 'lucide-react';
import { SearchHistoryItem } from '../hooks/useSearchHistory';

interface SearchHistoryDropdownProps {
    isOpen: boolean;
    recentSearches: SearchHistoryItem[];
    savedSearches: SearchHistoryItem[];
    onSelectSearch: (query: string) => void;
    onToggleSaved: (id: string) => void;
    onRemove: (id: string) => void;
    onClearHistory: () => void;
}

export const SearchHistoryDropdown: React.FC<SearchHistoryDropdownProps> = ({
    isOpen,
    recentSearches,
    savedSearches,
    onSelectSearch,
    onToggleSaved,
    onRemove,
    onClearHistory,
}) => {
    if (!isOpen || (recentSearches.length === 0 && savedSearches.length === 0)) {
        return null;
    }

    return (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#0a0505]/98 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            {/* Saved Searches */}
            {savedSearches.length > 0 && (
                <div className="p-2 border-b border-white/5">
                    <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        <Star size={10} className="text-amber-400" />
                        Saved Searches
                    </div>
                    {savedSearches.map((item) => (
                        <SearchItem
                            key={item.id}
                            item={item}
                            onSelect={onSelectSearch}
                            onToggleSaved={onToggleSaved}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            )}

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
                <div className="p-2">
                    <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <Clock size={10} />
                            Recent
                        </span>
                        <button
                            onClick={onClearHistory}
                            className="text-[10px] text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1"
                        >
                            <Trash2 size={10} />
                            Clear
                        </button>
                    </div>
                    {recentSearches.map((item) => (
                        <SearchItem
                            key={item.id}
                            item={item}
                            onSelect={onSelectSearch}
                            onToggleSaved={onToggleSaved}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

interface SearchItemProps {
    item: SearchHistoryItem;
    onSelect: (query: string) => void;
    onToggleSaved: (id: string) => void;
    onRemove: (id: string) => void;
}

const SearchItem: React.FC<SearchItemProps> = ({
    item,
    onSelect,
    onToggleSaved,
    onRemove,
}) => {
    return (
        <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <button
                onClick={() => onSelect(item.query)}
                className="flex-1 text-left text-sm text-slate-300 hover:text-white transition-colors truncate"
            >
                {item.query}
            </button>

            <div className="hidden group-hover:flex items-center gap-1">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleSaved(item.id);
                    }}
                    className={`p-1 rounded transition-colors ${item.isSaved
                            ? 'text-amber-400 hover:text-amber-300'
                            : 'text-slate-500 hover:text-amber-400'
                        }`}
                    title={item.isSaved ? 'Unsave' : 'Save search'}
                >
                    <Star size={12} fill={item.isSaved ? 'currentColor' : 'none'} />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove(item.id);
                    }}
                    className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors"
                    title="Remove"
                >
                    <X size={12} />
                </button>
            </div>
        </div>
    );
};

export default SearchHistoryDropdown;
