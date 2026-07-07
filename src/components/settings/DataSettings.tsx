import {
  Brain,
  ChevronDown,
  ChevronUp,
  Download,
  FileJson,
  FolderOpen,
  RefreshCw,
  Upload,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { Button } from "../common/Button";
import { STORAGE_KEYS } from "../../constants";
import { aiService } from "../../services/aiService";
import storageService from "../../services/storageService";
import { BULK_TASK_TEMPLATE_JSON } from "../../utils/bulkTaskSchema";
import type {
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  Task,
  ToastType,
} from "../../../types";
import { DestructiveConfirm } from "./DestructiveConfirm";

const MAX_IMPORT_FILE_BYTES = 25_000_000;

interface AppData {
  projects: Project[];
  tasks: Task[];
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  customFields: CustomFieldDefinition[];
}

interface DataSettingsProps {
  downloadLink: string;
  appData: AppData;
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
  onBulkCreateTasks?: (tasks: Partial<Task>[]) => void;
  handleReset: () => void;
}

export const DataSettings: React.FC<DataSettingsProps> = ({
  downloadLink,
  appData,
  addToast,
  importText,
  setImportText,
  importError,
  handleImport,
  isImporting,
  showTemplateRef,
  setShowTemplateRef,
  handleDownloadTemplate,
  setBulkTasksJson,
  bulkTasksJson,
  bulkImportError,
  handleBulkImport,
  isBulkImporting,
  onBulkCreateTasks,
  handleReset,
}) => {
  const [smartImportText, setSmartImportText] = useState("");
  const [isSmartImporting, setIsSmartImporting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const backupFileRef = useRef<HTMLInputElement>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const [dragTarget, setDragTarget] = useState<"backup" | "bulk" | null>(null);

  const loadJsonFile = async (file: File, setText: (val: string) => void) => {
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      addToast("Please choose a .json file", "error");
      return;
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      addToast(
        `File is too large (max ${Math.round(MAX_IMPORT_FILE_BYTES / 1_000_000)} MB)`,
        "error",
      );
      return;
    }

    try {
      const text = await file.text();
      setText(text);
      addToast(`Loaded ${file.name}`, "success");
    } catch (err) {
      console.error(err);
      addToast("Could not read the selected file", "error");
    }
  };

  const handleFilePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setText: (val: string) => void,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await loadJsonFile(file, setText);
  };

  const handleDrop = async (e: React.DragEvent, setText: (val: string) => void) => {
    e.preventDefault();
    setDragTarget(null);
    const file = e.dataTransfer.files?.[0];
    if (file) await loadJsonFile(file, setText);
  };

  const handleSmartImport = async () => {
    if (!smartImportText.trim() || !onBulkCreateTasks) return;

    setIsSmartImporting(true);
    addToast("AI is analyzing your export...", "info");

    try {
      const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
      const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
      const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

      const context = { activeProjectId, projects, priorities };
      const mappedTasks = await aiService.smartImportFromText(smartImportText, context);

      if (mappedTasks && mappedTasks.length > 0) {
        onBulkCreateTasks(mappedTasks);
        setSmartImportText("");
        addToast(`Successfully imported ${mappedTasks.length} tasks!`, "success");
      } else {
        addToast("AI could not find valid tasks in the provided text.", "info");
      }
    } catch (e) {
      console.error(e);
      addToast("AI Smart Import failed", "error");
    } finally {
      setIsSmartImporting(false);
    }
  };

  const dropZoneClass = (target: "backup" | "bulk") =>
    `w-full bg-[#05080f] border rounded-xl p-3 text-xs text-slate-400 font-mono resize-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
      dragTarget === target ? "border-red-500/60 bg-red-900/10" : "border-white/10"
    }`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="space-y-3 bg-red-900/10 border border-red-500/20 p-4 rounded-xl">
        <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
          <Brain size={14} />
          Switch to LiquiTask (AI Smart Import)
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Paste CSV or JSON from Jira, Trello, Linear, or Asana. AI will auto-map it to your current
          project.
        </p>
        <textarea
          value={smartImportText}
          onChange={(e) => setSmartImportText(e.target.value)}
          placeholder="Paste external data dump here..."
          className="w-full h-24 bg-black/40 border border-red-500/20 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:border-red-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20"
        />
        <Button
          onClick={handleSmartImport}
          disabled={!smartImportText.trim() || isSmartImporting || !onBulkCreateTasks}
          isLoading={isSmartImporting}
          fullWidth
          color="red"
          icon={<Brain size={16} />}
        >
          Extract & Import Tasks
        </Button>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Export Data
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={downloadLink}
            download="liquitask-backup.json"
            className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl text-slate-300 no-underline hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <Download size={16} />
            <span className="text-sm font-medium">JSON Backup</span>
          </a>
          <button
            type="button"
            onClick={async () => {
              const { exportService } = await import("../../services/exportService");
              const pm = new Map<string, string>(
                appData.projects.map((p: Project) => [p.id, p.name]),
              );
              exportService.downloadCSV(appData.tasks, "liquitask-export.csv", pm);
              addToast("Exported to CSV", "success");
            }}
            className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl text-slate-300 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <Download size={16} />
            <span className="text-sm font-medium">CSV Export</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Import App Backup
        </h4>
        <input
          ref={backupFileRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => handleFilePick(e, setImportText)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => backupFileRef.current?.click()}
          className="flex items-center justify-center gap-2 w-full p-2.5 bg-white/5 border border-white/10 rounded-xl text-slate-400 text-xs hover:text-white hover:bg-white/10 transition-colors"
        >
          <FolderOpen size={14} />
          <span className="font-medium">Choose JSON file…</span>
        </button>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragTarget("backup");
          }}
          onDragLeave={() => setDragTarget(null)}
          onDrop={(e) => handleDrop(e, setImportText)}
          placeholder="…or paste or drop a LiquiTask backup JSON here"
          className={`h-24 ${dropZoneClass("backup")}`}
        />
        {importText && (
          <p className="text-[10px] text-slate-600 px-1">
            {importText.length.toLocaleString()} characters loaded
          </p>
        )}
        {importError && (
          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {importError}
          </p>
        )}
        <Button
          onClick={handleImport}
          disabled={!importText.trim() || isImporting}
          isLoading={isImporting}
          fullWidth
          variant="danger"
          icon={<Upload size={16} />}
        >
          Restore Backup
        </Button>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <FileJson size={14} />
            Manual Bulk Import
          </h4>
          <button
            type="button"
            onClick={() => setShowTemplateRef(!showTemplateRef)}
            className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
          >
            {showTemplateRef ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Template
          </button>
        </div>
        {showTemplateRef && (
          <div className="bg-black/30 rounded-lg p-3 border border-white/5 max-h-40 overflow-y-auto custom-scrollbar">
            <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap">
              {BULK_TASK_TEMPLATE_JSON}
            </pre>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="w-full p-2.5 bg-white/5 border border-white/10 rounded-lg text-slate-400 text-xs hover:text-white transition-colors"
          >
            Download template
          </button>
          <input
            ref={bulkFileRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => handleFilePick(e, setBulkTasksJson)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => bulkFileRef.current?.click()}
            className="flex items-center justify-center gap-2 w-full p-2.5 bg-white/5 border border-white/10 rounded-lg text-slate-400 text-xs hover:text-white transition-colors"
          >
            <FolderOpen size={14} />
            Choose JSON file…
          </button>
        </div>
        <textarea
          value={bulkTasksJson}
          onChange={(e) => setBulkTasksJson(e.target.value)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragTarget("bulk");
          }}
          onDragLeave={() => setDragTarget(null)}
          onDrop={(e) => handleDrop(e, setBulkTasksJson)}
          placeholder="…or paste or drop a bulk tasks JSON here"
          className={`h-32 ${dropZoneClass("bulk")}`}
        />
        {bulkImportError && (
          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {bulkImportError}
          </p>
        )}
        <Button
          onClick={handleBulkImport}
          disabled={!bulkTasksJson.trim() || isBulkImporting || !onBulkCreateTasks}
          isLoading={isBulkImporting}
          fullWidth
          color="red"
          icon={<FileJson size={16} />}
        >
          Import Tasks to Current Project
        </Button>
      </div>

      <div className="pt-4 border-t border-white/5">
        {showResetConfirm ? (
          <DestructiveConfirm
            message={
              <>
                This will erase all projects, tasks, and settings. Type <strong>RESET</strong> to
                confirm.
              </>
            }
            confirmWord="RESET"
            confirmLabel="Reset app"
            onConfirm={() => {
              handleReset();
              setShowResetConfirm(false);
            }}
            onCancel={() => setShowResetConfirm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-red-400 transition-colors w-full justify-center py-2"
          >
            <RefreshCw size={14} /> Reset app to defaults…
          </button>
        )}
      </div>
    </div>
  );
};
