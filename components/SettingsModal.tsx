import React, { useState } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { Settings, Shield, Palette, LogOut, Database, Download, Upload, RefreshCw, Kanban, Plus, Trash2, CheckSquare, Flag, Layout, SlidersHorizontal, Type, Hash, List, Link, Loader2, FileJson, ChevronDown, ChevronUp } from 'lucide-react';
import { Project, Task, BoardColumn, ProjectType, PriorityDefinition, GroupingOption, ToastType, CustomFieldDefinition } from '../types';
import storageService from '../src/services/storageService';
import { validateBulkTasks, BULK_TASK_TEMPLATE_JSON, generateTemplateBlob } from '../src/utils/bulkTaskSchema';

interface ImportedData {
  projects: Project[];
  tasks: Task[];
  columns: BoardColumn[];
  projectTypes?: ProjectType[];
  priorities?: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData?: ImportedData;
  onImportData?: (data: ImportedData) => void;
  onUpdateColumns?: (columns: BoardColumn[]) => void;
  onUpdateProjectTypes?: (types: ProjectType[]) => void;
  onUpdatePriorities?: (priorities: PriorityDefinition[]) => void;
  onUpdateCustomFields?: (fields: CustomFieldDefinition[]) => void;
  grouping?: GroupingOption;
  onUpdateGrouping?: (option: GroupingOption) => void;
  addToast: (msg: string, type: ToastType) => void;
  onBulkCreateTasks?: (tasks: Partial<Task>[]) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appData,
  onImportData,
  onUpdateColumns,
  onUpdateProjectTypes,
  onUpdatePriorities,
  onUpdateCustomFields,
  grouping = 'none',
  onUpdateGrouping,
  addToast,
  onBulkCreateTasks
}) => {
  const [activeTab, setActiveTab] = useState('general');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Bulk task import state
  const [bulkTasksJson, setBulkTasksJson] = useState('');
  const [bulkImportError, setBulkImportError] = useState<string | null>(null);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [showTemplateRef, setShowTemplateRef] = useState(false);

  // Local state
  const [localColumns, setLocalColumns] = useState<BoardColumn[]>(appData?.columns || []);
  const [localProjectTypes, setLocalProjectTypes] = useState<ProjectType[]>(appData?.projectTypes || []);
  const [localPriorities, setLocalPriorities] = useState<PriorityDefinition[]>(appData?.priorities || []);
  const [localCustomFields, setLocalCustomFields] = useState<CustomFieldDefinition[]>(appData?.customFields || []);
  const [localGrouping, setLocalGrouping] = useState<GroupingOption>(grouping);

  // Sync with appData
  React.useEffect(() => {
    if (appData?.columns) setLocalColumns(appData.columns);
    if (appData?.projectTypes) setLocalProjectTypes(appData.projectTypes);
    if (appData?.priorities) setLocalPriorities(appData.priorities);
    if (appData?.customFields) setLocalCustomFields(appData.customFields);
    setLocalGrouping(grouping);
  }, [appData, grouping, isOpen]);

  const tabs = [
    { id: 'general', icon: <Settings size={16} />, label: 'General' },
    { id: 'workflow', icon: <Kanban size={16} />, label: 'Workflow' },
    { id: 'fields', icon: <SlidersHorizontal size={16} />, label: 'Fields' },
    { id: 'priorities', icon: <Flag size={16} />, label: 'Priorities' },
    { id: 'data', icon: <Database size={16} />, label: 'Data' },
  ];

  const handleImport = async () => {
    if (!importText.trim()) return;

    setIsImporting(true);
    setImportError(null);

    try {
      // Use storageService for validated import
      const result = storageService.importData(importText);

      if (result.error || !result.data) {
        throw new Error(result.error || 'Import validation failed');
      }

      const validatedData = result.data;

      onImportData?.({
        projects: validatedData.projects,
        tasks: validatedData.tasks,
        columns: validatedData.columns,
        projectTypes: validatedData.projectTypes,
        priorities: validatedData.priorities,
        customFields: validatedData.customFields
      });

      setImportText('');
      setImportError(null);
      addToast('Data imported and validated successfully!', 'success');
      onClose();
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Invalid JSON syntax';
      setImportError(errorMessage);
      addToast(`Import failed: ${errorMessage}`, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("WARNING: This will wipe all current data and restore defaults. This cannot be undone.")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  // Bulk task import handler
  const handleBulkImport = async () => {
    if (!bulkTasksJson.trim()) return;

    setIsBulkImporting(true);
    setBulkImportError(null);

    try {
      const result = validateBulkTasks(bulkTasksJson);

      if (!result.valid || !result.tasks) {
        throw new Error(result.error || 'Validation failed');
      }

      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(w => addToast(w, 'info'));
      }

      if (onBulkCreateTasks) {
        onBulkCreateTasks(result.tasks);
        setBulkTasksJson('');
        setBulkImportError(null);
        addToast(`Successfully imported ${result.tasks.length} tasks!`, 'success');
      } else {
        throw new Error('Bulk import not configured. Please contact support.');
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Invalid JSON';
      setBulkImportError(errorMessage);
      addToast(`Import failed: ${errorMessage}`, 'error');
    } finally {
      setIsBulkImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const blob = generateTemplateBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'task-template.json';
    a.click();
    URL.revokeObjectURL(url);
    addToast('Template downloaded!', 'info');
  };

  const saveAll = () => {
    if (onUpdateColumns) onUpdateColumns(localColumns);
    if (onUpdateProjectTypes) onUpdateProjectTypes(localProjectTypes);
    if (onUpdatePriorities) onUpdatePriorities(localPriorities);
    if (onUpdateCustomFields) onUpdateCustomFields(localCustomFields);
    if (onUpdateGrouping) onUpdateGrouping(localGrouping);
    addToast('Configuration saved successfully.', 'success');
  };

  // Helper functions for array updates
  const updateItem = <T,>(list: T[], index: number, field: keyof T, value: T[keyof T], setter: React.Dispatch<React.SetStateAction<T[]>>) => {
    const newList = [...list];
    newList[index] = { ...newList[index], [field]: value };
    setter(newList);
  };

  const deleteItem = <T,>(list: T[], index: number, setter: React.Dispatch<React.SetStateAction<T[]>>, minLength = 0) => {
    if (list.length <= minLength) {
      addToast("Cannot remove last item.", 'error');
      return;
    }
    setter(list.filter((_, i) => i !== index));
  };

  const addColumn = () => {
    setLocalColumns([...localColumns, { id: `col-${Date.now()}`, title: 'New Column', color: '#64748b', isCompleted: false, wipLimit: 0 }]);
  };

  const addProjectType = () => {
    setLocalProjectTypes([...localProjectTypes, { id: `type-${Date.now()}`, label: 'New Type', icon: 'folder' }]);
  };

  const addPriority = () => {
    const maxLevel = localPriorities.length > 0 ? Math.max(...localPriorities.map(p => p.level)) : 0;
    setLocalPriorities([...localPriorities, { id: `prio-${Date.now()}`, label: 'New Priority', color: '#64748b', level: maxLevel + 1, icon: 'minus' }]);
  };

  // Custom Fields Logic
  const addCustomField = () => {
    setLocalCustomFields([...localCustomFields, { id: `cf-${Date.now()}`, label: 'New Field', type: 'text', options: [] }]);
  };

  const downloadLink = appData
    ? `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ ...appData, customFields: localCustomFields }, null, 2))}`
    : '#';

  const iconOptions = ['folder', 'code', 'megaphone', 'smartphone', 'box', 'briefcase', 'globe', 'cpu', 'shield', 'wrench', 'zap', 'truck', 'database', 'server', 'layout', 'pen-tool', 'music', 'video', 'camera', 'anchor', 'coffee'];
  const priorityIconOptions = ['flame', 'clock', 'arrow-down', 'arrow-up', 'zap', 'star', 'shield', 'alert-triangle', 'alert-circle', 'flag', 'minus'];

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      icon={<Settings size={20} />}
    >
      <div className="flex flex-col gap-6">

        {/* Tabs */}
        <div className="flex p-1 bg-[#05080f] rounded-xl border border-white/5 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                 flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap
                 ${activeTab === tab.id ? 'bg-white/10 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}
               `}
            >
              {tab.icon}
              <span className="">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="min-h-[300px] max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">

          {activeTab === 'general' && (
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
                  <div className="absolute right-0 top-[-1px] w-4 h-4 bg-emerald-500 rounded-full shadow-glow-green"></div>
                </div>
              </div>
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Board Layout</h4>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setLocalGrouping('none')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${localGrouping === 'none' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
                  >
                    <Kanban size={24} />
                    <span className="text-xs font-bold">Standard Columns</span>
                  </button>
                  <button
                    onClick={() => setLocalGrouping('priority')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${localGrouping === 'priority' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
                  >
                    <Layout size={24} />
                    <span className="text-xs font-bold">Swimlanes (Priority)</span>
                  </button>
                </div>
              </div>

              {/* Theme Toggle */}
              <div className="space-y-3 pt-4 border-t border-white/5">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Appearance</h4>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400"><Palette size={18} /></div>
                    <div>
                      <h4 className="text-sm font-medium text-white">Theme</h4>
                      <p className="text-xs text-slate-500">Switch between dark and light mode</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        document.documentElement.classList.remove('theme-light');
                        localStorage.setItem('theme', 'dark');
                        addToast('Theme: Dark Mode', 'info');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!document.documentElement.classList.contains('theme-light')
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                        }`}
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => {
                        document.documentElement.classList.add('theme-light');
                        localStorage.setItem('theme', 'light');
                        addToast('Theme: Light Mode', 'info');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${document.documentElement.classList.contains('theme-light')
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                        }`}
                    >
                      Light
                    </button>
                  </div>
                </div>
              </div>

              <button onClick={saveAll} className="w-full mt-4 bg-gradient-to-r from-red-600 to-red-800 text-white text-sm font-semibold py-2.5 rounded-xl shadow-glow-red hover:shadow-lg transition-all">Save General Changes</button>
            </div>
          )}

          {activeTab === 'workflow' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Board Columns</h4>
                  <button onClick={addColumn} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"><Plus size={14} /> Add Column</button>
                </div>
                <div className="space-y-2">
                  {localColumns.map((col, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white/5 rounded-xl border border-white/5">
                      <input type="color" value={col.color.startsWith('#') ? col.color : '#64748b'} onChange={(e) => updateItem(localColumns, idx, 'color', e.target.value, setLocalColumns)} className="w-6 h-6 rounded border-none bg-transparent cursor-pointer" />
                      <div className="flex-1 flex flex-col gap-1">
                        <input type="text" value={col.title} onChange={(e) => updateItem(localColumns, idx, 'title', e.target.value, setLocalColumns)} className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full font-bold" placeholder="Name" />
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest">WIP Limit:</span>
                          <input
                            type="number"
                            min="0"
                            value={col.wipLimit || ''}
                            onChange={(e) => updateItem(localColumns, idx, 'wipLimit', parseInt(e.target.value) || 0, setLocalColumns)}
                            className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-0.5 w-12 text-center focus:outline-none focus:border-red-500/50"
                            placeholder="∞"
                          />
                        </div>
                      </div>
                      <button onClick={() => updateItem(localColumns, idx, 'isCompleted', !col.isCompleted, setLocalColumns)} className={`p-1.5 rounded-md ${col.isCompleted ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-600'}`} title="Mark as 'Completed' Phase"><CheckSquare size={14} /></button>
                      <button onClick={() => deleteItem(localColumns, idx, setLocalColumns, 1)} className="text-slate-600 hover:text-red-400 p-1.5"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-3 pt-4 border-t border-white/5">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace Icons</h4>
                  <button onClick={addProjectType} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"><Plus size={14} /> Add Type</button>
                </div>
                <div className="space-y-2">
                  {localProjectTypes.map((type, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white/5 rounded-xl border border-white/5">
                      <input type="text" value={type.label} onChange={(e) => updateItem(localProjectTypes, idx, 'label', e.target.value, setLocalProjectTypes)} className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full" />
                      <select value={type.icon} onChange={(e) => updateItem(localProjectTypes, idx, 'icon', e.target.value, setLocalProjectTypes)} className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-1 w-24 focus:outline-none">
                        {iconOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                      <button onClick={() => deleteItem(localProjectTypes, idx, setLocalProjectTypes, 1)} className="text-slate-600 hover:text-red-400 p-1.5"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={saveAll} className="w-full mt-4 bg-gradient-to-r from-red-600 to-red-800 text-white text-sm font-semibold py-2.5 rounded-xl shadow-glow-red hover:shadow-lg transition-all">Save Workflow Changes</button>
            </div>
          )}

          {activeTab === 'fields' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Task Fields</h4>
                  <button onClick={addCustomField} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"><Plus size={14} /> Add Field</button>
                </div>
                <div className="space-y-3">
                  {localCustomFields.map((field, idx) => (
                    <div key={idx} className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-white/5 rounded text-slate-400">
                          {field.type === 'text' && <Type size={14} />}
                          {field.type === 'number' && <Hash size={14} />}
                          {field.type === 'dropdown' && <List size={14} />}
                          {field.type === 'url' && <Link size={14} />}
                        </div>
                        <input type="text" value={field.label} onChange={(e) => updateItem(localCustomFields, idx, 'label', e.target.value, setLocalCustomFields)} className="bg-transparent border-none text-sm font-bold text-slate-200 focus:outline-none flex-1" placeholder="Field Name" />
                        <select value={field.type} onChange={(e) => updateItem(localCustomFields, idx, 'type', e.target.value, setLocalCustomFields)} className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-1 focus:outline-none">
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="dropdown">Dropdown</option>
                          <option value="url">URL</option>
                        </select>
                        <button onClick={() => deleteItem(localCustomFields, idx, setLocalCustomFields)} className="text-slate-600 hover:text-red-400 p-1.5"><Trash2 size={14} /></button>
                      </div>
                      {field.type === 'dropdown' && (
                        <input
                          type="text"
                          value={field.options?.join(', ') || ''}
                          onChange={(e) => updateItem(localCustomFields, idx, 'options', e.target.value.split(',').map(s => s.trim()), setLocalCustomFields)}
                          className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 placeholder-slate-600"
                          placeholder="Options separated by comma (e.g. High, Low, Medium)"
                        />
                      )}
                    </div>
                  ))}
                  {localCustomFields.length === 0 && <p className="text-xs text-slate-600 italic text-center py-4">No custom fields defined.</p>}
                </div>
              </div>
              <button onClick={saveAll} className="w-full mt-4 bg-gradient-to-r from-red-600 to-red-800 text-white text-sm font-semibold py-2.5 rounded-xl shadow-glow-red hover:shadow-lg transition-all">Save Fields</button>
            </div>
          )}

          {activeTab === 'priorities' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Priorities</h4>
                  <button onClick={addPriority} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"><Plus size={14} /> Add Priority</button>
                </div>
                <div className="space-y-2">
                  {localPriorities.map((prio, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white/5 rounded-xl border border-white/5">
                      <input type="color" value={prio.color} onChange={(e) => updateItem(localPriorities, idx, 'color', e.target.value, setLocalPriorities)} className="w-6 h-6 rounded border-none bg-transparent cursor-pointer" />
                      <input type="text" value={prio.label} onChange={(e) => updateItem(localPriorities, idx, 'label', e.target.value, setLocalPriorities)} className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full" />
                      <select value={prio.icon || 'minus'} onChange={(e) => updateItem(localPriorities, idx, 'icon', e.target.value, setLocalPriorities)} className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-1 w-24 focus:outline-none">
                        {priorityIconOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                      <button onClick={() => deleteItem(localPriorities, idx, setLocalPriorities, 1)} className="text-slate-600 hover:text-red-400 p-1.5"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={saveAll} className="w-full mt-4 bg-gradient-to-r from-red-600 to-red-800 text-white text-sm font-semibold py-2.5 rounded-xl shadow-glow-red hover:shadow-lg transition-all">Save Priority Changes</button>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Export Data</h4>
                <a href={downloadLink} download={`liquitask-backup.json`} className="flex items-center justify-center gap-2 w-full p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-slate-300 transition-all cursor-pointer no-underline"><Download size={16} /><span className="text-sm font-medium">Download JSON Snapshot</span></a>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Import Data</h4>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste JSON schema here..." className="w-full h-24 bg-[#05080f] border border-white/10 rounded-xl p-3 text-xs text-slate-400 font-mono focus:outline-none focus:border-red-500/50 resize-none" />
                {importError && <p className="text-xs text-red-400 px-1">{importError}</p>}
                <button onClick={handleImport} disabled={!importText.trim() || isImporting} className="flex items-center justify-center gap-2 w-full p-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 rounded-xl text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  <span className="text-sm font-medium">{isImporting ? 'Validating & Importing...' : 'Import from JSON'}</span>
                </button>
              </div>

              {/* Bulk Task Import Section */}
              <div className="space-y-3 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <FileJson size={14} />
                    Bulk Import Tasks
                  </h4>
                  <button
                    onClick={() => setShowTemplateRef(!showTemplateRef)}
                    className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
                  >
                    {showTemplateRef ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showTemplateRef ? 'Hide' : 'Show'} Template
                  </button>
                </div>

                {showTemplateRef && (
                  <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                    <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap">
                      {BULK_TASK_TEMPLATE_JSON}
                    </pre>
                  </div>
                )}

                <button
                  onClick={handleDownloadTemplate}
                  className="flex items-center justify-center gap-2 w-full p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-400 hover:text-white text-xs transition-all"
                >
                  <Download size={14} />
                  Download Template File
                </button>

                {/* File Input for Import */}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  id="bulk-task-file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const content = event.target?.result as string;
                      if (content) {
                        setBulkTasksJson(content);
                        addToast(`Loaded ${file.name}`, 'info');
                      }
                    };
                    reader.onerror = () => {
                      addToast('Failed to read file', 'error');
                    };
                    reader.readAsText(file);
                    e.target.value = ''; // Reset for re-selecting same file
                  }}
                />
                <label
                  htmlFor="bulk-task-file-input"
                  className="flex items-center justify-center gap-2 w-full p-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 rounded-lg text-emerald-400 text-xs transition-all cursor-pointer"
                >
                  <Upload size={14} />
                  Import from File (.json)
                </label>

                <textarea
                  value={bulkTasksJson}
                  onChange={(e) => setBulkTasksJson(e.target.value)}
                  placeholder={'{\n  "tasks": [\n    { "title": "Task 1", "priority": "high" }\n  ]\n}'}
                  className="w-full h-32 bg-[#05080f] border border-white/10 rounded-xl p-3 text-xs text-slate-400 font-mono focus:outline-none focus:border-blue-500/50 resize-none"
                />

                {bulkImportError && <p className="text-xs text-red-400 px-1">{bulkImportError}</p>}

                <button
                  onClick={handleBulkImport}
                  disabled={!bulkTasksJson.trim() || isBulkImporting || !onBulkCreateTasks}
                  className="flex items-center justify-center gap-2 w-full p-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 rounded-xl text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isBulkImporting ? <Loader2 size={16} className="animate-spin" /> : <FileJson size={16} />}
                  <span className="text-sm font-medium">{isBulkImporting ? 'Importing Tasks...' : 'Import Tasks to Current Project'}</span>
                </button>

                <p className="text-[10px] text-slate-600 text-center">
                  Tasks will be added to the currently active project
                </p>
              </div>
              <div className="pt-4 border-t border-white/5">
                <button onClick={handleReset} className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-red-400 transition-colors w-full justify-center"><RefreshCw size={14} /> Reset App to Defaults</button>
              </div>
            </div>
          )}
        </div>
        <div className="pt-4 border-t border-white/5 flex justify-between items-center">
          <span className="text-xs text-slate-600">v3.3.0 (WIP Limits & DnD)</span>
          <button className="flex items-center gap-2 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"><LogOut size={14} /> Sign Out</button>
        </div>
      </div>
    </ModalWrapper>
  );
};