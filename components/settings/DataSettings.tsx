import React from 'react';
import { Download, Upload, Loader2, FileJson, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { Project, Task, ToastType } from '../../types';
import { BULK_TASK_TEMPLATE_JSON } from '../../src/utils/bulkTaskSchema';

interface DataSettingsProps {
  downloadLink: string;
  appData: any;
  addToast: (msg: string, type: ToastType) => void;
  importText: string;
  setImportText: (val: string) => void;
  importError: string;
  handleImport: () => void;
  isImporting: boolean;
  showTemplateRef: boolean;
  setShowTemplateRef: (val: boolean) => void;
  handleDownloadTemplate: () => void;
  setBulkTasksJson: (val: string) => void;
  bulkTasksJson: string;
  bulkImportError: string;
  handleBulkImport: () => void;
  isBulkImporting: boolean;
  onBulkCreateTasks?: (tasks: any[]) => void;
  handleReset: () => void;
}

export const DataSettings: React.FC<DataSettingsProps> = ({
  downloadLink, appData, addToast, importText, setImportText, importError, handleImport, isImporting,
  showTemplateRef, setShowTemplateRef, handleDownloadTemplate, setBulkTasksJson, bulkTasksJson,
  bulkImportError, handleBulkImport, isBulkImporting, onBulkCreateTasks, handleReset
}) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Export Data</h4>
        <div className="grid grid-cols-2 gap-2">
          <a href={downloadLink} download="liquitask-backup.json" className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl text-slate-300 no-underline hover:bg-white/10"><Download size={16} /><span className="text-sm font-medium">JSON</span></a>
          <button onClick={async () => { const { exportService } = await import('../../src/services/exportService'); const pm = new Map<string, string>(appData.projects.map((p: any) => [p.id, p.name])); exportService.downloadCSV(appData.tasks, 'liquitask-export.csv', pm); addToast('Exported to CSV', 'success'); }} className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl text-slate-300 hover:bg-white/10"><Download size={16} /><span className="text-sm font-medium">CSV</span></button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Import Data</h4>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste JSON here..." className="w-full h-24 bg-[#05080f] border border-white/10 rounded-xl p-3 text-xs text-slate-400 font-mono resize-none" />
        {importError && <p className="text-xs text-red-400">{importError}</p>}
        <button onClick={handleImport} disabled={!importText.trim() || isImporting} className="flex items-center justify-center gap-2 w-full p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 disabled:opacity-50 transition-all">
          {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          <span className="text-sm font-medium">Import from JSON</span>
        </button>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2"><FileJson size={14} />Bulk Import</h4>
          <button onClick={() => setShowTemplateRef(!showTemplateRef)} className="text-xs text-slate-500 flex items-center gap-1">{showTemplateRef ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Template</button>
        </div>
        {showTemplateRef && <div className="bg-black/30 rounded-lg p-3 border border-white/5"><pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap">{BULK_TASK_TEMPLATE_JSON}</pre></div>}
        <button onClick={handleDownloadTemplate} className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-slate-400 text-xs hover:text-white">Download Template</button>
        <textarea value={bulkTasksJson} onChange={(e) => setBulkTasksJson(e.target.value)} placeholder="Paste bulk tasks JSON here..." className="w-full h-32 bg-[#05080f] border border-white/10 rounded-xl p-3 text-xs text-slate-400 font-mono resize-none" />
        <button onClick={handleBulkImport} disabled={!bulkTasksJson.trim() || isBulkImporting || !onBulkCreateTasks} className="w-full p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400 disabled:opacity-50">
          {isBulkImporting ? <Loader2 size={16} className="animate-spin" /> : <FileJson size={16} />}
          <span className="text-sm font-medium">Import Tasks to Current Project</span>
        </button>
      </div>

      <div className="pt-4 border-t border-white/5">
        <button onClick={handleReset} className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-red-400 transition-colors w-full justify-center"><RefreshCw size={14} /> Reset App to Defaults</button>
      </div>
    </div>
  );
};
