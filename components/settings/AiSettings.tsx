import {
  Brain,
  CheckCircle2,
  Download,
  GitBranch,
  Globe,
  Key,
  Loader2,
  Merge,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "../../src/constants";
import { aiService } from "../../src/services/aiService";
import storageService from "../../src/services/storageService";
import { sanitizeUrl } from "../../src/utils/validation";
import type { AIConfig, AutoOrganizeConfig, ToastType } from "../../types";
import { Tooltip } from "../Tooltip";

interface AiSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
  onOpenMergeModal?: () => void;
  onOpenReorganizeModal?: () => void;
  onOpenSubtaskModal?: () => void;
  onOpenProjectAssignmentModal?: () => void;
  onOpenHealthDashboard?: () => void;
  onOpenBulkOperations?: () => void;
  onOpenAutoOrganize?: () => void;
  onOpenInsights?: () => void;
}

const DEFAULT_AI_CONFIG: AIConfig = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3.1-flash-lite",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "",
};

export const AiSettings: React.FC<AiSettingsProps> = ({
  addToast,
  onOpenMergeModal,
  onOpenReorganizeModal,
  onOpenSubtaskModal,
  onOpenProjectAssignmentModal,
  onOpenHealthDashboard,
  onOpenBulkOperations,
  onOpenAutoOrganize,
  onOpenInsights,
}) => {
  const [config, setConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);

  const [aiManagement, setAiManagement] = useState({
    autoDetectDuplicates: false,
    autoSuggestPriorities: false,
    autoSuggestTags: false,
    cleanupOnCreate: false,
    insightsFrequency: "manual" as "daily" | "weekly" | "manual",
  });

  const defaultAutoOrganize: AutoOrganizeConfig = {
    enabled: false,
    autoApplyThreshold: 0.85,
    suggestThreshold: 0.7,
    schedule: "manual",
    operations: {
      clustering: true,
      deduplication: true,
      autoTagging: true,
      hierarchyDetection: true,
      projectAssignment: true,
      tagConsolidation: true,
    },
    excludedProjectIds: [],
    maxTasksPerBatch: 100,
  };

  const [autoOrganize, setAutoOrganize] = useState<AutoOrganizeConfig>(defaultAutoOrganize);

  const [workspacePaths, setWorkspacePaths] = useState<string[]>([]);

  const [_isTesting, setIsTesting] = useState(false);
  const [_testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatus, setPullStatus] = useState("");
  const [pullController, setPullController] = useState<AbortController | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [_modelFetchError, setModelFetchError] = useState<string | null>(null);

  const fetchModels = useCallback(async (baseUrl: string, retryCount = 0) => {
    if (!baseUrl) return;

    const normalizedBaseUrl = sanitizeUrl(baseUrl);
    setIsLoadingModels(true);
    setModelFetchError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const storedConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
      storageService.set(STORAGE_KEYS.AI_CONFIG, {
        ...(storedConfig ?? DEFAULT_AI_CONFIG),
        ollamaBaseUrl: normalizedBaseUrl,
      });

      const models = await aiService.listModels(controller.signal);
      setAvailableModels(models);
      setConfig((prev) => ({
        ...prev,
        ollamaBaseUrl: normalizedBaseUrl,
        ollamaModel: models.length > 0 && !prev.ollamaModel ? models[0] : prev.ollamaModel,
      }));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setModelFetchError("Request timed out");
      } else {
        console.warn("Could not fetch Ollama models:", e);
        if (retryCount < 1) {
          setTimeout(() => fetchModels(baseUrl, retryCount + 1), 1000);
          return;
        }
        setModelFetchError(e instanceof Error ? e.message : "Could not reach Ollama");
      }
      setAvailableModels([]);
    } finally {
      clearTimeout(timeoutId);
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    const savedConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    if (savedConfig) {
      setConfig((prev) => ({ ...prev, ...savedConfig }));
      setAiManagement({
        autoDetectDuplicates: savedConfig.autoDetectDuplicates ?? false,
        autoSuggestPriorities: savedConfig.autoSuggestPriorities ?? false,
        autoSuggestTags: savedConfig.autoSuggestTags ?? false,
        cleanupOnCreate: savedConfig.cleanupOnCreate ?? false,
        insightsFrequency: savedConfig.insightsFrequency ?? "manual",
      });
      if (savedConfig.autoOrganize) {
        setAutoOrganize(savedConfig.autoOrganize);
      }
      if (savedConfig.provider === "ollama" && savedConfig.ollamaBaseUrl) {
        fetchModels(savedConfig.ollamaBaseUrl);
      }
    } else {
      const oldKey = storageService.get<string>(STORAGE_KEYS.GEMINI_API_KEY, "");
      if (oldKey) {
        setConfig((prev) => {
          const migrated = { ...prev, geminiApiKey: oldKey };
          storageService.set(STORAGE_KEYS.AI_CONFIG, migrated);
          return migrated;
        });
      }
    }
  }, [fetchModels]);

  useEffect(() => {
    if (window.electronAPI?.workspace) {
      window.electronAPI.workspace.getPaths().then(setWorkspacePaths);
    }
  }, []);

  useEffect(() => {
    if (config.provider === "ollama") {
      fetchModels(config.ollamaBaseUrl || "http://localhost:11434");
    }
  }, [config.provider, config.ollamaBaseUrl, fetchModels]);

  const handleSave = () => {
    const sanitizedConfig = {
      ...config,
      ollamaBaseUrl: sanitizeUrl(config.ollamaBaseUrl),
      autoDetectDuplicates: aiManagement.autoDetectDuplicates,
      autoSuggestPriorities: aiManagement.autoSuggestPriorities,
      autoSuggestTags: aiManagement.autoSuggestTags,
      cleanupOnCreate: aiManagement.cleanupOnCreate,
      insightsFrequency: aiManagement.insightsFrequency,
      autoOrganize,
    };
    storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
    setConfig(sanitizedConfig);
    addToast("AI configuration saved successfully", "success");
  };

  const _handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const sanitizedConfig = {
        ...config,
        ollamaBaseUrl: sanitizeUrl(config.ollamaBaseUrl),
      };
      storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
      setConfig(sanitizedConfig);

      const result = await aiService.testProviderConnection();

      setTestResult(result.ok ? "success" : "error");
      if (result.ok) {
        addToast(result.message, "success");
        if (config.provider === "ollama") fetchModels(sanitizedConfig.ollamaBaseUrl);
      } else {
        addToast(result.message, "error");
      }
    } catch (e) {
      setTestResult("error");
      addToast((e as Error).message || "Connection test failed", "error");
    } finally {
      setIsTesting(false);
    }
  };

  const handlePullModel = async () => {
    if (!config.ollamaModel) {
      addToast("Please enter a model name to pull", "error");
      return;
    }

    const controller = new AbortController();
    setPullController(controller);
    setIsPulling(true);
    setPullProgress(0);
    setPullStatus("Starting pull...");

    try {
      const sanitizedConfig = {
        ...config,
        ollamaBaseUrl: sanitizeUrl(config.ollamaBaseUrl),
      };
      storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
      setConfig(sanitizedConfig);

      await aiService.pullModel(
        config.ollamaModel,
        (status, percentage) => {
          setPullStatus(status);
          if (percentage !== undefined) setPullProgress(percentage);
        },
        controller.signal,
      );

      addToast(`Successfully pulled ${config.ollamaModel}`, "success");
      setTestResult("success");
      fetchModels(sanitizedConfig.ollamaBaseUrl);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        addToast("Pull cancelled", "info");
      } else {
        addToast((e as Error).message || "Failed to pull model", "error");
      }
    } finally {
      setIsPulling(false);
      setPullProgress(0);
      setPullStatus("");
      setPullController(null);
    }
  };

  const handleCancelPull = () => {
    pullController?.abort();
  };

  const handleOllamaUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const sanitized = sanitizeUrl(e.target.value);
    setConfig({ ...config, ollamaBaseUrl: sanitized });
    fetchModels(sanitized);
  };

  const updateAutoOrganizeOperation = (
    key: keyof AutoOrganizeConfig["operations"],
    value: boolean,
  ) => {
    setAutoOrganize((prev) => ({
      ...prev,
      operations: {
        ...prev.operations,
        [key]: value,
      },
    }));
  };

  const handleAddWorkspacePath = async () => {
    if (!window.electronAPI?.workspace) return;

    const selectedPath = await window.electronAPI.workspace.selectDirectory();
    if (!selectedPath || workspacePaths.includes(selectedPath)) return;

    const updated = [...workspacePaths, selectedPath];
    setWorkspacePaths(updated);
    await window.electronAPI.workspace.setPaths(updated);
    addToast("Workspace path added", "success");
  };

  const handleRemoveWorkspacePath = async (pathToRemove: string) => {
    const updated = workspacePaths.filter((p) => p !== pathToRemove);
    setWorkspacePaths(updated);
    if (window.electronAPI?.workspace) {
      await window.electronAPI.workspace.setPaths(updated);
    }
    addToast("Workspace path removed", "info");
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
          <Sparkles size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">AI Integrations</h3>
          <p className="text-sm text-slate-400">
            Choose your AI provider to enable smart task creation and refinement.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <label className="text-sm font-medium text-slate-300 mb-3 block">Active Provider</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setConfig({ ...config, provider: "gemini" })}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${config.provider === "gemini" ? "bg-cyan-500/20 border-cyan-500 text-cyan-300" : "bg-black/20 border-white/10 text-slate-400 hover:border-white/20"}`}
            >
              <Globe size={18} />
              <div className="text-left">
                <div className="text-sm font-bold">Google Gemini</div>
                <div className="text-[10px] opacity-60">Cloud-based, reliable</div>
              </div>
            </button>
            <button
              onClick={() => setConfig({ ...config, provider: "ollama" })}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${config.provider === "ollama" ? "bg-amber-500/20 border-amber-500 text-amber-300" : "bg-black/20 border-white/10 text-slate-400 hover:border-white/20"}`}
            >
              <Server size={18} />
              <div className="text-left">
                <div className="text-sm font-bold">Ollama</div>
                <div className="text-[10px] opacity-60">Local, private</div>
              </div>
            </button>
          </div>
        </div>

        {config.provider === "gemini" && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Key size={16} /> Gemini API Key
              </label>
              <input
                type="password"
                value={config.geminiApiKey}
                onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                placeholder="AIzaSy..."
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                Model Name
              </label>
              <input
                type="text"
                value={config.geminiModel}
                onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })}
                placeholder="e.g. gemini-3.1-flash-lite"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <p className="text-xs text-slate-500">
              Get your API key from{" "}
              <a
                href="https://aistudio.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline"
              >
                Google AI Studio
              </a>
              , then paste the exact Gemini model name you want to use.
            </p>
          </div>
        )}

        {config.provider === "ollama" && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Globe size={16} /> Ollama Base URL
              </label>
              <input
                type="text"
                value={config.ollamaBaseUrl}
                onChange={(e) => setConfig({ ...config, ollamaBaseUrl: e.target.value })}
                onBlur={handleOllamaUrlBlur}
                placeholder="http://localhost:11434"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Server size={16} /> Model Name
                </label>
                <Tooltip content="Refresh downloaded models" position="top">
                  <button
                    onClick={() => fetchModels(config.ollamaBaseUrl || "http://localhost:11434")}
                    disabled={isLoadingModels}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <RefreshCw size={14} className={isLoadingModels ? "animate-spin" : ""} />
                  </button>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                {availableModels.length > 0 ? (
                  <select
                    value={config.ollamaModel}
                    onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-amber-500 appearance-none"
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    {config.ollamaModel && !availableModels.includes(config.ollamaModel) && (
                      <option value={config.ollamaModel}>
                        {config.ollamaModel} (Not downloaded)
                      </option>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.ollamaModel}
                    onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                    placeholder="llama3, mistral, etc."
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />
                )}
                <Tooltip content="Download model from Ollama" position="top">
                  <button
                    onClick={handlePullModel}
                    disabled={isPulling || !config.ollamaModel}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                  >
                    {isPulling ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Download size={16} />
                    )}
                    <span className="text-xs font-bold hidden sm:inline">Pull</span>
                  </button>
                </Tooltip>
              </div>
              {availableModels.length === 0 && !isLoadingModels && (
                <p className="text-xs text-amber-500/70 mt-2">
                  Make sure Ollama is running to see available models.
                </p>
              )}
            </div>

            {isPulling && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                  <span>{pullStatus}</span>
                  <div className="flex items-center gap-2">
                    <span>{pullProgress}%</span>
                    <button
                      onClick={handleCancelPull}
                      className="text-red-400 hover:text-red-300 transition-colors px-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-amber-500 transition-all duration-300 ease-out"
                    style={{ width: `${pullProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={18} className="text-cyan-400" />
            <h4 className="text-sm font-bold text-white">Workspace Integration</h4>
          </div>
          <p className="text-[10px] text-slate-500 mb-2">
            Allow the AI to read and write .md files in these directories for external task
            tracking.
            <span className="ml-1 text-cyan-500/70 italic">Saves automatically.</span>
          </p>

          <button
            onClick={handleAddWorkspacePath}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-all text-xs font-bold"
          >
            <Plus size={14} /> Add Workspace Folder
          </button>

          {workspacePaths.length > 0 && (
            <ul className="space-y-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
              {workspacePaths.map((p) => (
                <li
                  key={p}
                  className="flex items-center justify-between gap-2 p-2 bg-black/20 border border-white/5 rounded-lg group"
                >
                  <Tooltip content={p} position="top">
                    <span className="text-[10px] text-slate-300 truncate">{p}</span>
                  </Tooltip>
                  <Tooltip content="Remove path" position="top">
                    <button
                      onClick={() => handleRemoveWorkspacePath(p)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={18} className="text-cyan-400" />
            <h4 className="text-sm font-bold text-white">AI Task Management</h4>
          </div>

          <div className="space-y-3">
            <ToggleRow
              icon={Merge}
              label="Auto-Detect Duplicates"
              description="Scan for duplicate tasks when creating"
              checked={aiManagement.autoDetectDuplicates}
              onChange={(v) => setAiManagement((prev) => ({ ...prev, autoDetectDuplicates: v }))}
            />

            <ToggleRow
              icon={Zap}
              label="Auto-Suggest Priorities"
              description="AI adjusts priorities based on context"
              checked={aiManagement.autoSuggestPriorities}
              onChange={(v) => setAiManagement((prev) => ({ ...prev, autoSuggestPriorities: v }))}
            />

            <ToggleRow
              icon={Tags}
              label="Auto-Suggest Tags"
              description="AI recommends relevant tags for tasks"
              checked={aiManagement.autoSuggestTags}
              onChange={(v) => setAiManagement((prev) => ({ ...prev, autoSuggestTags: v }))}
            />

            <ToggleRow
              icon={Trash2}
              label="Cleanup on Create"
              description="Run redundancy check after task creation"
              checked={aiManagement.cleanupOnCreate}
              onChange={(v) => setAiManagement((prev) => ({ ...prev, cleanupOnCreate: v }))}
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Settings2 size={16} className="text-slate-400" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Insights Frequency</div>
                  <div className="text-[10px] text-slate-500">
                    How often to generate AI insights
                  </div>
                </div>
              </div>
              <select
                value={aiManagement.insightsFrequency}
                onChange={(e) =>
                  setAiManagement((prev) => ({
                    ...prev,
                    insightsFrequency: e.target.value as "daily" | "weekly" | "manual",
                  }))
                }
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 appearance-none"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <RefreshCw size={18} className="text-purple-400" />
              <h4 className="text-sm font-bold text-white">Auto-Organize</h4>
            </div>
            <ToggleRow
              icon={() => null}
              label=""
              description=""
              aria-label="Toggle Auto-Organize"
              checked={autoOrganize.enabled}
              onChange={(v) => setAutoOrganize((prev) => ({ ...prev, enabled: v }))}
            />
          </div>

          {autoOrganize.enabled && (
            <div className="space-y-3 pl-4 border-l border-white/10 animate-in fade-in slide-in-from-left-2">
              <ToggleRow
                icon={Sparkles}
                label="Clustering"
                description="Group similar tasks into projects"
                checked={autoOrganize.operations.clustering}
                onChange={(v) => updateAutoOrganizeOperation("clustering", v)}
              />
              <ToggleRow
                icon={Merge}
                label="Deduplication"
                description="Identify and merge duplicate tasks"
                checked={autoOrganize.operations.deduplication}
                onChange={(v) => updateAutoOrganizeOperation("deduplication", v)}
              />
              <ToggleRow
                icon={Tags}
                label="Auto-Tagging"
                description="Automatically apply relevant tags"
                checked={autoOrganize.operations.autoTagging}
                onChange={(v) => updateAutoOrganizeOperation("autoTagging", v)}
              />
              <ToggleRow
                icon={GitBranch}
                label="Hierarchy Detection"
                description="Detect parent-child task relationships"
                checked={autoOrganize.operations.hierarchyDetection}
                onChange={(v) => updateAutoOrganizeOperation("hierarchyDetection", v)}
              />
              <ToggleRow
                icon={Globe}
                label="Project Assignment"
                description="Suggest projects for uncategorized tasks"
                checked={autoOrganize.operations.projectAssignment}
                onChange={(v) => updateAutoOrganizeOperation("projectAssignment", v)}
              />
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
            Quick Actions
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onOpenMergeModal}
              disabled={!onOpenMergeModal}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg text-xs font-bold transition-all border border-cyan-500/20"
            >
              <Merge size={14} /> Merge
            </button>
            <button
              onClick={onOpenReorganizeModal}
              disabled={!onOpenReorganizeModal}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg text-xs font-bold transition-all border border-purple-500/20"
            >
              <Sparkles size={14} /> Reorganize
            </button>
            <button
              onClick={onOpenSubtaskModal}
              disabled={!onOpenSubtaskModal}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg text-xs font-bold transition-all border border-green-500/20"
            >
              <GitBranch size={14} /> Subtasks
            </button>
            <button
              onClick={onOpenProjectAssignmentModal}
              disabled={!onOpenProjectAssignmentModal}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold transition-all border border-blue-500/20"
            >
              <Globe size={14} /> Assign
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onOpenBulkOperations}
              disabled={!onOpenBulkOperations}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-xs font-bold transition-all border border-orange-500/20"
            >
              <Settings2 size={14} /> Bulk Ops
            </button>
            <button
              onClick={onOpenAutoOrganize}
              disabled={!onOpenAutoOrganize}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-bold transition-all border border-rose-500/20"
            >
              <RefreshCw size={14} /> Auto-Org
            </button>
          </div>
          <button
            onClick={onOpenHealthDashboard}
            disabled={!onOpenHealthDashboard}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold transition-all border border-emerald-500/20"
          >
            <CheckCircle2 size={14} /> AI Health Dashboard
          </button>
          <button
            onClick={onOpenInsights}
            disabled={!onOpenInsights}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg text-xs font-bold transition-all border border-indigo-500/20"
          >
            <Brain size={14} /> AI Insights
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={_handleTestConnection}
            disabled={isPulling || _isTesting}
            className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold border border-white/10 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {_isTesting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Zap size={16} className="text-amber-400" />
            )}
            Test Connection
          </button>
          <button
            onClick={handleSave}
            disabled={isPulling}
            className="flex-[2] px-4 py-3 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-xl text-sm font-bold shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
          >
            Save Configuration
          </button>
        </div>
      </div>

      {(config.provider === "ollama" || _testResult) && (
        <div className="space-y-2">
          {config.provider === "ollama" && (
            <p className="text-xs text-slate-500">
              Test Connection checks the Ollama service, confirms the model is installed, and asks
              that model for a real response.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
        <CheckCircle2 size={12} />
        Your AI credentials and settings are stored locally on this device and never shared.
      </div>
    </div>
  );
};

interface ToggleRowProps {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
  disabled = false,
  ...props
}) => {
  const handleToggle = useCallback(() => {
    if (!disabled) onChange(!checked);
  }, [checked, onChange, disabled]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={props["aria-label"] || label}
      aria-disabled={disabled}
      disabled={disabled}
      className={`flex items-center justify-between w-full cursor-pointer group py-2 rounded-lg transition-opacity ${
        disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          handleToggle();
        }
      }}
    >
      <div className="flex items-center gap-3 pointer-events-none">
        <Icon
          size={16}
          className={`transition-colors ${
            checked ? "text-cyan-400" : "text-slate-400 group-hover:text-slate-300"
          }`}
        />
        <div className="text-left">
          <div className="text-sm font-medium text-slate-200">{label}</div>
          <div className="text-[10px] text-slate-500">{description}</div>
        </div>
      </div>
      <div
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
          checked ? "bg-cyan-500" : "bg-white/10 group-hover:bg-white/15"
        }`}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          } group-hover:scale-105 active:scale-95`}
        />
      </div>
    </button>
  );
};
