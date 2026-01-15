import React, { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { Settings, Shield, Palette, LogOut, Database, Download, Upload, RefreshCw, Kanban, Plus, Trash2, CheckSquare, Flag, Layout, SlidersHorizontal, Type, Hash, List, Link, Loader2, FileJson, ChevronDown, ChevronUp, FolderTree, Keyboard, Zap, FileText, BarChart3, Archive, Edit2 } from 'lucide-react';
import { Project, Task, BoardColumn, ProjectType, PriorityDefinition, GroupingOption, ToastType, CustomFieldDefinition } from '../types';
import storageService from '../src/services/storageService';
import { validateBulkTasks, BULK_TASK_TEMPLATE_JSON, generateTemplateBlob } from '../src/utils/bulkTaskSchema';
import { useKeybinding } from '../src/context/KeybindingContext';
import { exportService } from '../src/services/exportService';
import { archiveService } from '../src/services/archiveService';
import { automationService, AutomationRule } from '../src/services/automationService';
import { templateService } from '../src/services/templateService';
import { timeReportingService } from '../src/services/timeReportingService';
import { AutomationRuleEditor } from '../src/components/AutomationRuleEditor';
import logo from '../src/assets/logo.png';

interface ImportedData {
  projects?: Project[];
  tasks?: Task[];
  columns?: BoardColumn[];
  projectTypes?: ProjectType[];
  priorities?: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: {
    projects: Project[];
    tasks: Task[];
    columns: BoardColumn[];
    projectTypes: ProjectType[];
    priorities: PriorityDefinition[];
    customFields: CustomFieldDefinition[];
  };
  onImportData: (data: ImportedData) => void;
  onUpdateColumns: (cols: BoardColumn[]) => void;
  onUpdateProjectTypes: (types: ProjectType[]) => void;
  onUpdatePriorities: (priorities: PriorityDefinition[]) => void;
  onUpdateCustomFields: (fields: CustomFieldDefinition[]) => void;
  grouping: GroupingOption;
  onUpdateGrouping: (grouping: GroupingOption) => void;
  addToast: (message: string, type: ToastType) => void;
  onBulkCreateTasks?: (tasks: Partial<Task>[]) => void;
  showSubWorkspaceTasks: boolean;
  onUpdateShowSubWorkspaceTasks?: (show: boolean) => void;
  onOpenArchiveView?: () => void;
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
  onBulkCreateTasks,
  showSubWorkspaceTasks = false,
  onUpdateShowSubWorkspaceTasks,
  onOpenArchiveView
}) => {
  const [activeTab, setActiveTab] = useState('general');

  // Local state for editing
  const [localGrouping, setLocalGrouping] = useState<GroupingOption>(grouping);
  const [localColumns, setLocalColumns] = useState<BoardColumn[]>([]);
  const [localProjectTypes, setLocalProjectTypes] = useState<ProjectType[]>([]);
  const [localPriorities, setLocalPriorities] = useState<PriorityDefinition[]>([]);
  const [localCustomFields, setLocalCustomFields] = useState<CustomFieldDefinition[]>([]);

  // Import/Export state
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [downloadLink, setDownloadLink] = useState('');

  // Bulk Import state
  const [bulkTasksJson, setBulkTasksJson] = useState('');
  const [bulkImportError, setBulkImportError] = useState('');
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [showTemplateRef, setShowTemplateRef] = useState(false);

  // Automation Rule Editor state
  const [isRuleEditorOpen, setIsRuleEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);

  // Archive View state


  // Keybinding Context
  const { keybindings, updateKeybinding, resetKeybindings } = useKeybinding();

  // Sync state when opening
  useEffect(() => {
    if (isOpen) {
      setLocalGrouping(grouping);
      setLocalColumns(JSON.parse(JSON.stringify(appData.columns || [])));
      setLocalProjectTypes(JSON.parse(JSON.stringify(appData.projectTypes || [])));
      setLocalPriorities(JSON.parse(JSON.stringify(appData.priorities || [])));
      setLocalCustomFields(JSON.parse(JSON.stringify(appData.customFields || [])));

      // Generate backup download link
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
      setDownloadLink(dataStr);
    }
  }, [isOpen, appData, grouping]);

  const saveAll = () => {
    onUpdateGrouping(localGrouping);
    onUpdateColumns(localColumns);
    onUpdateProjectTypes(localProjectTypes);
    onUpdatePriorities(localPriorities);
    onUpdateCustomFields(localCustomFields);
    addToast('Settings saved successfully', 'success');
  };

  const updateItem = <T,>(list: T[], index: number, field: keyof T, value: T[keyof T], setter: (list: T[]) => void) => {
    const newList = [...list];
    newList[index] = { ...newList[index], [field]: value };
    setter(newList);
  };

  const deleteItem = <T,>(list: T[], index: number, setter: (list: T[]) => void, minLength: number = 0) => {
    if (list.length <= minLength) {
      addToast(`Cannot delete. Minimum ${minLength} items required.`, 'error');
      return;
    }
    const newList = [...list];
    newList.splice(index, 1);
    setter(newList);
  };

  const addColumn = () => {
    setLocalColumns([...localColumns, { id: `col-${Date.now()}`, title: 'New Column', color: '#64748b', wipLimit: 0 }]);
  };

  const addProjectType = () => {
    setLocalProjectTypes([...localProjectTypes, { id: `type-${Date.now()}`, label: 'New Type', icon: 'folder' }]);
  };

  const addPriority = () => {
    setLocalPriorities([...localPriorities, { id: `prio-${Date.now()}`, label: 'New Priority', color: '#64748b', level: localPriorities.length + 1 }]);
  };

  const addCustomField = () => {
    setLocalCustomFields([...localCustomFields, { id: `field-${Date.now()}`, label: 'New Field', type: 'text' }]);
  };

  const handleImport = () => {
    try {
      setIsImporting(true);
      setImportError('');
      const data = JSON.parse(importText);

      // Basic validation
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON format');

      onImportData(data);
      addToast('Data imported successfully', 'success');
      setImportText('');
      onClose();
    } catch (e) {
      setImportError((e as Error).message);
      addToast('Import failed: ' + (e as Error).message, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all app data? This cannot be undone.')) {
      storageService.clear();
      window.location.reload();
    }
  };

  const handleDownloadTemplate = () => {
    const blob = generateTemplateBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_task_template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkImport = () => {
    if (!onBulkCreateTasks) return;

    try {
      setIsBulkImporting(true);
      setBulkImportError('');

      const parsed = JSON.parse(bulkTasksJson);
      const validation = validateBulkTasks(bulkTasksJson);

      if (!validation.valid) {
        setBulkImportError(validation.error || 'Validation failed');
        addToast('Validation failed', 'error');
        return;
      }

      onBulkCreateTasks(parsed.tasks);
      addToast(`Successfully imported ${parsed.tasks.length} tasks`, 'success');
      setBulkTasksJson('');
      onClose();
    } catch (e) {
      setBulkImportError((e as Error).message);
      addToast('Invalid JSON', 'error');
    } finally {
      setIsBulkImporting(false);
    }
  };

  const iconOptions = ['folder', 'code', 'megaphone', 'smartphone', 'box', 'globe', 'database', 'cloud', 'lock'];
  const priorityIconOptions = ['flame', 'clock', 'arrow-down', 'alert-circle', 'check-circle'];

  const tabs = [
    { id: 'general', icon: <Settings size={16} />, label: 'General' },
    { id: 'workflow', icon: <Kanban size={16} />, label: 'Workflow' },
    { id: 'fields', icon: <SlidersHorizontal size={16} />, label: 'Fields' },
    { id: 'priorities', icon: <Flag size={16} />, label: 'Priorities' },
    { id: 'automation', icon: <Zap size={16} />, label: 'Automation' },
    { id: 'templates', icon: <FileText size={16} />, label: 'Templates' },
    { id: 'reports', icon: <BarChart3 size={16} />, label: 'Reports' },
    { id: 'archive', icon: <Archive size={16} />, label: 'Archive' },
    { id: 'shortcuts', icon: <Keyboard size={16} />, label: 'Shortcuts' },
    { id: 'data', icon: <Database size={16} />, label: 'Data' },
  ];

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      icon={<Settings size={20} />}
      logo={logo}
      size="5xl"
    >
      <div className="flex gap-6 h-[600px] -m-8">
        {/* Sidebar */}
        <div className="w-64 bg-black/20 border-r border-white/5 p-4 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
          <div className="mb-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Configuration
          </div>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all text-left group
                ${activeTab === tab.id
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'}
              `}
            >
              <div className={`
                p-1.5 rounded-md transition-all
                ${activeTab === tab.id ? 'bg-red-500/20 text-red-500' : 'bg-white/5 text-slate-500 group-hover:text-slate-300'}
              `}>
                {tab.icon}
              </div>
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              )}
            </button>
          ))}

          <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
            <span className="block text-[10px] text-slate-600 px-2">v3.3.0 (WIP Limits & DnD)</span>
            <button className="flex items-center gap-2 px-2 py-1.5 w-full text-xs font-medium text-red-400 hover:text-red-300 hover:bg-white/5 rounded-lg transition-colors">
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar bg-gradient-to-br from-transparent to-red-900/5">

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

              {/* Workspace Settings */}
              <div className="space-y-3 pt-4 border-t border-white/5">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</h4>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400"><FolderTree size={18} /></div>
                    <div>
                      <h4 className="text-sm font-medium text-white">Show Sub-Workspace Tasks</h4>
                      <p className="text-xs text-slate-500">Display tasks from sub-workspaces in main workspace</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !showSubWorkspaceTasks;
                      onUpdateShowSubWorkspaceTasks?.(newValue);
                      addToast(newValue ? 'Sub-workspace tasks enabled' : 'Sub-workspace tasks disabled', 'info');
                    }}
                    className={`relative w-12 h-6 rounded-full transition-all ${showSubWorkspaceTasks ? 'bg-cyan-500/20 border border-cyan-500/50' : 'bg-slate-700/50 border border-slate-600/50'}`}
                    aria-label={showSubWorkspaceTasks ? 'Disable sub-workspace tasks' : 'Enable sub-workspace tasks'}
                    title={showSubWorkspaceTasks ? 'Disable sub-workspace tasks' : 'Enable sub-workspace tasks'}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all ${showSubWorkspaceTasks ? 'bg-cyan-400 translate-x-6 shadow-lg' : 'bg-slate-500 translate-x-0'}`} />
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
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!document.documentElement.classList.contains('theme-light') ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => {
                        document.documentElement.classList.add('theme-light');
                        localStorage.setItem('theme', 'light');
                        addToast('Theme: Light Mode', 'info');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${document.documentElement.classList.contains('theme-light') ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
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
                      <input type="color" value={col.color.startsWith('#') ? col.color : '#64748b'} onChange={(e) => updateItem(localColumns, idx, 'color', e.target.value, setLocalColumns)} className="w-6 h-6 rounded border-none bg-transparent cursor-pointer" aria-label={`Color for column ${col.title || idx + 1}`} title={`Color for column ${col.title || idx + 1}`} />
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
                      <button onClick={() => deleteItem(localColumns, idx, setLocalColumns, 1)} className="text-slate-600 hover:text-red-400 p-1.5" aria-label={`Delete column ${col.title || idx + 1}`} title={`Delete column ${col.title || idx + 1}`}><Trash2 size={14} /></button>
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
                      <input type="text" value={type.label} onChange={(e) => updateItem(localProjectTypes, idx, 'label', e.target.value, setLocalProjectTypes)} className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full" aria-label={`Workspace type label ${idx + 1}`} placeholder="Type name" />
                      <select value={type.icon} onChange={(e) => updateItem(localProjectTypes, idx, 'icon', e.target.value, setLocalProjectTypes)} className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-1 w-24 focus:outline-none" aria-label={`Icon for workspace type ${type.label || idx + 1}`} title={`Icon for workspace type ${type.label || idx + 1}`}>
                        {iconOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                      <button onClick={() => deleteItem(localProjectTypes, idx, setLocalProjectTypes, 1)} className="text-slate-600 hover:text-red-400 p-1.5" aria-label={`Delete workspace type ${type.label || idx + 1}`} title={`Delete workspace type ${type.label || idx + 1}`}><Trash2 size={14} /></button>
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
                        <select value={field.type} onChange={(e) => updateItem(localCustomFields, idx, 'type', e.target.value, setLocalCustomFields)} className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-1 focus:outline-none" aria-label={`Field type for ${field.label || 'field ' + (idx + 1)}`} title={`Field type for ${field.label || 'field ' + (idx + 1)}`}>
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="dropdown">Dropdown</option>
                          <option value="url">URL</option>
                        </select>
                        <button onClick={() => deleteItem(localCustomFields, idx, setLocalCustomFields)} className="text-slate-600 hover:text-red-400 p-1.5" aria-label={`Delete custom field ${field.label || idx + 1}`} title={`Delete custom field ${field.label || idx + 1}`}><Trash2 size={14} /></button>
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
                      <input type="color" value={prio.color} onChange={(e) => updateItem(localPriorities, idx, 'color', e.target.value, setLocalPriorities)} className="w-6 h-6 rounded border-none bg-transparent cursor-pointer" aria-label={`Color for priority ${prio.label || idx + 1}`} title={`Color for priority ${prio.label || idx + 1}`} />
                      <input type="text" value={prio.label} onChange={(e) => updateItem(localPriorities, idx, 'label', e.target.value, setLocalPriorities)} className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full" aria-label={`Priority label ${idx + 1}`} placeholder="Priority name" />
                      <select value={prio.icon || 'minus'} onChange={(e) => updateItem(localPriorities, idx, 'icon', e.target.value, setLocalPriorities)} className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-1 w-24 focus:outline-none" aria-label={`Icon for priority ${prio.label || idx + 1}`} title={`Icon for priority ${prio.label || idx + 1}`}>
                        {priorityIconOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                      <button onClick={() => deleteItem(localPriorities, idx, setLocalPriorities, 1)} className="text-slate-600 hover:text-red-400 p-1.5" aria-label={`Delete priority ${prio.label || idx + 1}`} title={`Delete priority ${prio.label || idx + 1}`}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={saveAll} className="w-full mt-4 bg-gradient-to-r from-red-600 to-red-800 text-white text-sm font-semibold py-2.5 rounded-xl shadow-glow-red hover:shadow-lg transition-all">Save Priority Changes</button>
            </div>
          )}

          {activeTab === 'automation' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Automation Rules</h4>
                <button
                  onClick={() => {
                    setEditingRule(null);
                    setIsRuleEditorOpen(true);
                  }}
                  className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"
                >
                  <Plus size={14} /> Add Rule
                </button>
              </div>
              <div className="space-y-2">
                {automationService.getRules().map(rule => (
                  <div key={rule.id} className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => {
                            automationService.updateRule(rule.id, { enabled: e.target.checked });
                            storageService.set('liquitask-automation-rules', automationService.getRules());
                          }}
                          className="rounded"
                          aria-label={`Enable/disable rule: ${rule.name}`}
                          title={`Enable/disable rule: ${rule.name}`}
                        />
                        <span className="text-sm font-medium text-white">{rule.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditingRule(rule);
                            setIsRuleEditorOpen(true);
                          }}
                          className="text-slate-400 hover:text-blue-400 p-1"
                          aria-label={`Edit automation rule: ${rule.name}`}
                          title="Edit rule"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => {
                            automationService.deleteRule(rule.id);
                            storageService.set('liquitask-automation-rules', automationService.getRules());
                            addToast('Rule deleted', 'info');
                          }}
                          className="text-slate-600 hover:text-red-400 p-1"
                          aria-label={`Delete automation rule: ${rule.name}`}
                          title={`Delete automation rule: ${rule.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">
                      Trigger: {rule.trigger} • Actions: {rule.actions.length}
                      {rule.conditions && rule.conditions.rules.length > 0 && (
                        <span> • Has conditions</span>
                      )}
                    </div>
                  </div>
                ))}
                {automationService.getRules().length === 0 && (
                  <p className="text-xs text-slate-600 italic text-center py-4">No automation rules defined.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Task Templates</h4>
              </div>
              <div className="space-y-2">
                {templateService.getAllTemplates().map(template => (
                  <div key={template.id} className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="text-sm font-medium text-white">{template.name}</h5>
                        {template.description && (
                          <p className="text-xs text-slate-400 mt-1">{template.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          templateService.deleteTemplate(template.id);
                          storageService.set('liquitask-templates', templateService.getAllTemplates());
                          addToast('Template deleted', 'info');
                        }}
                        className="text-slate-600 hover:text-red-400 p-1"
                        aria-label={`Delete template: ${template.name}`}
                        title={`Delete template: ${template.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {templateService.getAllTemplates().length === 0 && (
                  <p className="text-xs text-slate-600 italic text-center py-4">No templates. Create one by right-clicking a task and selecting &quot;Save as Template&quot;.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Tracking Reports</h4>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      timeReportingService.generateTimeReport(appData.tasks, {
                        groupBy: 'project',
                      }, appData.projects);
                      const csv = timeReportingService.exportTimeDataToCSV(appData.tasks, appData.projects);
                      exportService.downloadFile(csv, 'time-report.csv', 'text/csv');
                      addToast('Time report exported', 'success');
                    }}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 transition-all"
                  >
                    <BarChart3 size={16} />
                    <span className="text-sm font-medium">Export Time Report (CSV)</span>
                  </button>
                  <button
                    onClick={() => {
                      const report = timeReportingService.generateTimeReport(appData.tasks, {
                        groupBy: 'assignee',
                      }, appData.projects);
                      const json = timeReportingService.exportTimeDataToJSON(report);
                      exportService.downloadFile(json, 'time-report.json', 'application/json');
                      addToast('Time report exported', 'success');
                    }}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 transition-all"
                  >
                    <BarChart3 size={16} />
                    <span className="text-sm font-medium">Export Time Report (JSON)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'archive' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Task Archive</h4>
                  <button
                    onClick={() => onOpenArchiveView?.()}
                    className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"
                  >
                    <Archive size={14} /> View Archive
                  </button>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h5 className="text-sm font-medium text-white">Archive Settings</h5>
                      <p className="text-xs text-slate-400 mt-1">Automatically archive completed tasks</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      const archived = await archiveService.archiveTasks(appData.tasks, {
                        autoArchiveAfterDays: 30,
                        archiveCompleted: true,
                        archiveStorage: 'localStorage',
                      });
                      addToast(`Archived ${appData.tasks.length - archived.length} tasks`, 'success');
                    }}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl text-amber-400 transition-all"
                  >
                    <Archive size={16} />
                    <span className="text-sm font-medium">Archive Completed Tasks</span>
                  </button>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                  <h5 className="text-sm font-medium text-white mb-2">Archive Statistics</h5>
                  <p className="text-xs text-slate-400">
                    Use archive to improve performance with large datasets.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Keyboard Shortcuts</h4>
                <button onClick={resetKeybindings} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300"><RefreshCw size={14} /> Reset Defaults</button>
              </div>
              <div className="space-y-3">
                {Object.entries(keybindings).map(([actionId, keys]) => {
                  const keyArray = Array.isArray(keys) ? keys : [];
                  return (
                    <div key={actionId} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white capitalize">{actionId.replace(/[-:]/g, ' ')}</span>
                      </div>
                      <input
                        type="text"
                        value={keyArray.join(', ')}
                        onChange={(e) => updateKeybinding(actionId, e.target.value.split(',').map(k => k.trim()))}
                        className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-48 text-right focus:border-red-500/50 outline-none font-mono"
                        placeholder="e.g. Meta+k"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Export Data</h4>
                <div className="grid grid-cols-2 gap-2">
                  <a href={downloadLink} download={`liquitask-backup.json`} className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-slate-300 transition-all cursor-pointer no-underline"><Download size={16} /><span className="text-sm font-medium">JSON</span></a>
                  <button
                    onClick={() => {
                      const projectMap = new Map<string, string>(appData.projects.map(p => [p.id, p.name]));
                      exportService.downloadCSV(appData.tasks, 'liquitask-export.csv', projectMap);
                      addToast('Exported to CSV', 'success');
                    }}
                    className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-slate-300 transition-all"
                  >
                    <Download size={16} />
                    <span className="text-sm font-medium">CSV</span>
                  </button>
                  <button
                    onClick={() => {
                      exportService.exportToICS(appData.tasks, 'liquitask-calendar.ics');
                      addToast('Exported to iCal', 'success');
                    }}
                    className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-slate-300 transition-all"
                  >
                    <Download size={16} />
                    <span className="text-sm font-medium">iCal</span>
                  </button>
                  <button
                    onClick={() => {
                      const markdown = exportService.exportToMarkdown(appData.tasks);
                      exportService.downloadFile(markdown, 'liquitask-export.md', 'text/markdown');
                      addToast('Exported to Markdown', 'success');
                    }}
                    className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-slate-300 transition-all"
                  >
                    <Download size={16} />
                    <span className="text-sm font-medium">Markdown</span>
                  </button>
                </div>
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
                  placeholder={`{
  "tasks": [
    { "title": "Task 1", "priority": "high" }
  ]
}`}
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
      </div>

      {/* Automation Rule Editor Modal */}
      {isRuleEditorOpen && (
        <AutomationRuleEditor
          rule={editingRule}
          onSave={(rule) => {
            if (editingRule) {
              automationService.updateRule(rule.id, rule);
            } else {
              automationService.addRule(rule);
            }
            storageService.set('liquitask-automation-rules', automationService.getRules());
            setIsRuleEditorOpen(false);
            setEditingRule(null);
            addToast(`Rule ${editingRule ? 'updated' : 'created'} successfully`, 'success');
          }}
          onCancel={() => {
            setIsRuleEditorOpen(false);
            setEditingRule(null);
          }}
          availablePriorities={appData.priorities.map(p => ({ id: p.id, label: p.label }))}
          availableColumns={appData.columns.map(c => ({ id: c.id, title: c.title }))}
        />
      )}
    </ModalWrapper>
  );
};
