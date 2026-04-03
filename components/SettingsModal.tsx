import { Database, Flag, Kanban, Keyboard, Settings, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import logo from "../src/assets/logo.png";
import { useKeybinding } from "../src/context/KeybindingContext";
import storageService from "../src/services/storageService";
import { generateTemplateBlob, validateBulkTasks } from "../src/utils/bulkTaskSchema";
import type {
  BoardColumn,
  CustomFieldDefinition,
  GroupingOption,
  PriorityDefinition,
  Project,
  ProjectType,
  Task,
  ToastType,
} from "../types";
import { ModalWrapper } from "./ModalWrapper";
import { AiSettings } from "./settings/AiSettings";
import { DataSettings } from "./settings/DataSettings";
// Sub-components
import { GeneralSettings } from "./settings/GeneralSettings";
import { PrioritySettings } from "./settings/PrioritySettings";
import { WorkflowSettings } from "./settings/WorkflowSettings";

interface ImportedData {
  projects?: Project[];
  tasks?: Task[];
  columns?: BoardColumn[];
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
    priorities: PriorityDefinition[];
    customFields: CustomFieldDefinition[];
    projectTypes?: ProjectType[];
  };
  onImportData: (data: ImportedData) => void;
  onUpdateColumns: (cols: BoardColumn[]) => void;
  onUpdatePriorities: (p: PriorityDefinition[]) => void;
  onUpdateCustomFields: (f: CustomFieldDefinition[]) => void;
  onUpdateProjectTypes?: (pt: ProjectType[]) => void;
  grouping: GroupingOption;
  onUpdateGrouping: (g: GroupingOption) => void;
  addToast: (m: string, t: ToastType) => void;
  onOpenMergeModal?: () => void;
  onOpenReorganizeModal?: () => void;
  onOpenSubtaskModal?: () => void;
  onBulkCreateTasks?: (tasks: Partial<Task>[]) => void;
  showSubWorkspaceTasks: boolean;
  onUpdateShowSubWorkspaceTasks?: (s: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appData,
  onImportData,
  onUpdateColumns,
  onUpdatePriorities,
  onUpdateCustomFields,
  onUpdateProjectTypes: _onUpdateProjectTypes,
  grouping = "none",
  onUpdateGrouping,
  addToast,
  onBulkCreateTasks,
  showSubWorkspaceTasks = false,
  onUpdateShowSubWorkspaceTasks,
  onOpenMergeModal,
  onOpenReorganizeModal,
  onOpenSubtaskModal,
}) => {
  const [activeTab, setActiveTab] = useState("general");
  const [localGrouping, setLocalGrouping] = useState<GroupingOption>(grouping);
  const [localColumns, setLocalColumns] = useState<BoardColumn[]>([]);
  const [localPriorities, setLocalPriorities] = useState<PriorityDefinition[]>(
    appData.priorities || [],
  );

  useEffect(() => {
    setLocalPriorities(appData.priorities || []);
  }, [appData.priorities]);
  const [localCustomFields, _setLocalCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [downloadLink, _setDownloadLink] = useState("");
  const [bulkTasksJson, setBulkTasksJson] = useState("");
  const [bulkImportError, setBulkImportError] = useState("");
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [showTemplateRef, setShowTemplateRef] = useState(false);

  const { keybindings, updateKeybinding, resetKeybindings } = useKeybinding();

  const saveAll = useCallback(() => {
    onUpdateGrouping(localGrouping);
    onUpdateColumns(localColumns);
    onUpdatePriorities(localPriorities);
    onUpdateCustomFields(localCustomFields);
    addToast("Settings saved", "success");
  }, [
    localGrouping,
    localColumns,
    localPriorities,
    localCustomFields,
    onUpdateGrouping,
    onUpdateColumns,
    onUpdatePriorities,
    onUpdateCustomFields,
    addToast,
  ]);

  const updateItem = <T extends Record<string, unknown>>(
    list: T[],
    index: number,
    field: keyof T,
    value: T[keyof T],
    setter: (l: T[]) => void,
  ) => {
    const newList = [...list];
    newList[index] = { ...newList[index], [field]: value };
    setter(newList);
  };

  const deleteItem = <T,>(list: T[], index: number, setter: (l: T[]) => void, min: number = 0) => {
    if (list.length <= min) {
      addToast(`Min ${min} items required`, "error");
      return;
    }
    const newList = [...list];
    newList.splice(index, 1);
    setter(newList);
  };

  const handleImport = () => {
    try {
      setIsImporting(true);
      setImportError("");
      const data = JSON.parse(importText);
      if (!data || typeof data !== "object") throw new Error("Invalid JSON");
      onImportData(data);
      addToast("Imported", "success");
      setImportText("");
      onClose();
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleBulkImport = () => {
    if (!onBulkCreateTasks) return;
    try {
      setIsBulkImporting(true);
      setBulkImportError("");
      const parsed = JSON.parse(bulkTasksJson);
      const val = validateBulkTasks(bulkTasksJson);
      if (!val.valid) {
        setBulkImportError(val.error || "Failed");
        return;
      }
      onBulkCreateTasks(parsed.tasks);
      addToast(`Imported ${parsed.tasks.length} tasks`, "success");
      setBulkTasksJson("");
      onClose();
    } catch (e) {
      setBulkImportError((e as Error).message);
    } finally {
      setIsBulkImporting(false);
    }
  };

  const tabs = [
    { id: "general", icon: <Settings size={16} />, label: "General" },
    { id: "workflow", icon: <Kanban size={16} />, label: "Workflow" },
    { id: "priorities", icon: <Flag size={16} />, label: "Priorities" },
    { id: "data", icon: <Database size={16} />, label: "Data" },
    { id: "shortcuts", icon: <Keyboard size={16} />, label: "Shortcuts" },
    { id: "ai", icon: <Sparkles size={16} />, label: "AI Settings" },
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
      <div className="flex h-[600px] overflow-hidden rounded-2xl border border-white/5 bg-black/10">
        <div className="w-64 shrink-0 bg-black/20 border-r border-white/5 p-4 flex flex-col gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all ${activeTab === tab.id ? "bg-red-500/10 text-red-400" : "text-slate-400 hover:bg-white/5"}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-8 overflow-y-auto custom-scrollbar">
          {activeTab === "general" && (
            <GeneralSettings
              localGrouping={localGrouping}
              setLocalGrouping={setLocalGrouping}
              showSubWorkspaceTasks={showSubWorkspaceTasks}
              onUpdateShowSubWorkspaceTasks={onUpdateShowSubWorkspaceTasks}
              addToast={addToast}
              saveAll={saveAll}
            />
          )}
          {activeTab === "workflow" && (
            <WorkflowSettings
              localColumns={localColumns}
              updateItem={updateItem}
              setLocalColumns={setLocalColumns}
              deleteItem={deleteItem}
              saveAll={saveAll}
            />
          )}
          {activeTab === "priorities" && (
            <PrioritySettings
              priorities={appData.priorities}
              onUpdatePriorities={(p) => {
                setLocalPriorities(p);
                onUpdatePriorities(p);
              }}
              addToast={addToast}
            />
          )}
          {activeTab === "data" && (
            <DataSettings
              downloadLink={downloadLink}
              appData={appData}
              addToast={addToast}
              importText={importText}
              setImportText={setImportText}
              importError={importError}
              handleImport={handleImport}
              isImporting={isImporting}
              showTemplateRef={showTemplateRef}
              setShowTemplateRef={setShowTemplateRef}
              handleDownloadTemplate={() => {
                const b = generateTemplateBlob();
                const u = URL.createObjectURL(b);
                const a = document.createElement("a");
                a.href = u;
                a.download = "template.json";
                a.click();
              }}
              setBulkTasksJson={setBulkTasksJson}
              bulkTasksJson={bulkTasksJson}
              bulkImportError={bulkImportError}
              handleBulkImport={handleBulkImport}
              isBulkImporting={isBulkImporting}
              onBulkCreateTasks={onBulkCreateTasks}
              handleReset={() => {
                if (confirm("Reset all?")) {
                  storageService.clear();
                  window.location.reload();
                }
              }}
            />
          )}
          {activeTab === "shortcuts" && (
            <div className="space-y-4">
              <button onClick={resetKeybindings} className="text-xs text-red-400 mb-4">
                Reset Defaults
              </button>
              {Object.entries(keybindings).map(([id, keys]) => (
                <div
                  key={id}
                  className="flex justify-between items-center p-3 bg-white/5 rounded-xl"
                >
                  <span className="text-sm text-white capitalize">{id.replace(/[-:]/g, " ")}</span>
                  <input
                    type="text"
                    value={(keys as string[]).join(", ")}
                    onChange={(e) =>
                      updateKeybinding(
                        id,
                        e.target.value.split(",").map((k) => k.trim()),
                      )
                    }
                    className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-48 text-right"
                  />
                </div>
              ))}
            </div>
          )}
          {activeTab === "ai" && (
            <AiSettings
              addToast={addToast}
              onOpenMergeModal={onOpenMergeModal}
              onOpenReorganizeModal={onOpenReorganizeModal}
              onOpenSubtaskModal={onOpenSubtaskModal}
            />
          )}
        </div>
      </div>
    </ModalWrapper>
  );
};
