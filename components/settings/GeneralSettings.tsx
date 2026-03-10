import React from 'react';
import { Shield, Kanban, Layout, FolderTree, Palette } from 'lucide-react';
import { GroupingOption, ToastType } from '../../types';

interface GeneralSettingsProps {
  localGrouping: GroupingOption;
  setLocalGrouping: (val: GroupingOption) => void;
  showSubWorkspaceTasks: boolean;
  onUpdateShowSubWorkspaceTasks?: (val: boolean) => void;
  addToast: (msg: string, type: ToastType) => void;
  saveAll: () => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  localGrouping, setLocalGrouping, showSubWorkspaceTasks, onUpdateShowSubWorkspaceTasks, addToast, saveAll
}) => {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400"><Shield size={18} /></div>
          <div>
            <h4 className="text-sm font-medium text-white">Data Encryption</h4>
            <p className="text-xs text-slate-500">Local storage enabled</p>
          </div>
        </div>
        <div className="w-8 h-4 bg-emerald-500/20 rounded-full border border-emerald-500/50 relative">
          <div className="absolute right-0 top-[-1px] w-4 h-4 bg-emerald-500 rounded-full"></div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Board Layout</h4>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setLocalGrouping('none')} className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${localGrouping === 'none' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-slate-400'}`}>
            <Kanban size={24} /><span className="text-xs font-bold">Standard</span>
          </button>
          <button onClick={() => setLocalGrouping('priority')} className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${localGrouping === 'priority' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-slate-400'}`}>
            <Layout size={24} /><span className="text-xs font-bold">Swimlanes</span>
          </button>
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</h4>
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400"><FolderTree size={18} /></div>
            <div>
              <h4 className="text-sm font-medium text-white">Show Sub-Workspace Tasks</h4>
            </div>
          </div>
          <button onClick={() => onUpdateShowSubWorkspaceTasks?.(!showSubWorkspaceTasks)} className={`relative w-12 h-6 rounded-full transition-all ${showSubWorkspaceTasks ? 'bg-cyan-500/20' : 'bg-slate-700/50'}`}>
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all ${showSubWorkspaceTasks ? 'bg-cyan-400 translate-x-6' : 'bg-slate-500'}`} />
          </button>
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Appearance</h4>
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400"><Palette size={18} /></div>
            <div><h4 className="text-sm font-medium text-white">Theme</h4></div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { document.documentElement.classList.remove('theme-light'); localStorage.setItem('theme', 'dark'); addToast('Dark Mode', 'info'); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5">Dark</button>
            <button onClick={() => { document.documentElement.classList.add('theme-light'); localStorage.setItem('theme', 'light'); addToast('Light Mode', 'info'); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5">Light</button>
          </div>
        </div>
      </div>

      <button onClick={saveAll} className="w-full mt-4 bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl">Save Changes</button>
    </div>
  );
};
