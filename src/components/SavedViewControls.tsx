import React, { useState } from 'react';
import { Save, ChevronDown, Check, Trash2, Layout, Plus, Search } from 'lucide-react';
import { SavedView } from '../../types';
import { Button } from './common/Button';

interface SavedViewControlsProps {
    views: SavedView[];
    activeViewId: string | null;
    onApplyView: (id: string) => void;
    onCreateView: (name: string) => void;
    onDeleteView: (id: string) => void;
}

export const SavedViewControls: React.FC<SavedViewControlsProps> = ({
    views,
    activeViewId,
    onApplyView,
    onCreateView,
    onDeleteView,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newViewName, setNewViewName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const activeView = views.find(v => v.id === activeViewId);
    const filteredViews = views.filter(v => v.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (newViewName.trim()) {
            onCreateView(newViewName);
            setNewViewName('');
            setIsCreating(false);
            setIsOpen(false);
        }
    };

    return (
        <div className="relative">
            {/* Trigger Button */}
            <Button
                onClick={() => setIsOpen(!isOpen)}
                variant="secondary"
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${activeView
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 ring-1 ring-blue-500/30'
                    : ''
                    }`}
            >
                <Layout size={16} />
                <span className="max-w-[100px] truncate">
                    {activeView ? activeView.name : 'Views'}
                </span>
                <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>

            {/* Dropdown Menu */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-72 bg-[#0a0e17] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">

                        {/* Header / Search */}
                        <div className="p-3 border-b border-white/5 space-y-2">
                            <div className="relative">
                                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="Search views..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-black/20 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                        </div>

                        {/* List */}
                        <div className="max-h-[300px] overflow-y-auto p-1 custom-scrollbar">
                            {filteredViews.length === 0 ? (
                                <div className="p-4 text-center text-xs text-slate-500">No views found</div>
                            ) : (
                                filteredViews.map(view => (
                                    <div
                                        key={view.id}
                                        className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${view.id === activeViewId ? 'bg-blue-500/10' : 'hover:bg-white/5'}`}
                                        onClick={() => {
                                            onApplyView(view.id);
                                            setIsOpen(false);
                                        }}
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            {view.id === activeViewId && <Check size={14} className="text-blue-400 shrink-0" />}
                                            <span className={`text-sm truncate ${view.id === activeViewId ? 'text-blue-400 font-medium' : 'text-slate-300'}`}>
                                                {view.name}
                                            </span>
                                            {view.isDefault && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-500">Default</span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {!view.isDefault && (
                                                <Button
                                                    onClick={(e) => { e.stopPropagation(); onDeleteView(view.id); }}
                                                    variant="danger"
                                                    size="sm"
                                                    className="p-1.5 h-auto"
                                                    aria-label={`Delete view "${view.name}"`}
                                                    title="Delete View"
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer / Create */}
                        <div className="p-2 border-t border-white/5 bg-white/[0.02]">
                            {isCreating ? (
                                <form onSubmit={handleCreate} className="flex gap-2">
                                    <input
                                        type="text"
                                        autoFocus
                                        value={newViewName}
                                        onChange={(e) => setNewViewName(e.target.value)}
                                        placeholder="View Name..."
                                        className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
                                    />
                                    <Button
                                        type="submit"
                                        disabled={!newViewName.trim()}
                                        variant="primary"
                                        color="blue"
                                        size="sm"
                                        className="rounded-lg"
                                        aria-label="Save view"
                                        title="Save view"
                                    >
                                        <Save size={14} />
                                    </Button>
                                </form>
                            ) : (
                                <Button
                                    onClick={() => setIsCreating(true)}
                                    variant="ghost"
                                    fullWidth
                                    className="justify-center gap-2 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
                                >
                                    <Plus size={14} />
                                    Save Current View
                                </Button>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
