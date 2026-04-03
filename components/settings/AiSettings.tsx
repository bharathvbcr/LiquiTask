import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Download,
  Globe,
  Key,
  Loader2,
  Merge,
  RefreshCw,
  Server,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  Zap,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "../../src/constants";
import { aiService } from "../../src/services/aiService";
import storageService from "../../src/services/storageService";
import { sanitizeUrl } from "../../src/utils/validation";
import type { AIConfig, ToastType } from "../../types";

interface AiSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
}

export const AiSettings: React.FC<AiSettingsProps> = ({ addToast }) => {
  const [config, setConfig] = useState<AIConfig>({
    provider: "gemini",
    geminiApiKey: "",
    geminiModel: "gemini-3.1-flash-lite",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "",
  });

  const [aiManagement, setAiManagement] = useState({
    autoDetectDuplicates: false,
    autoSuggestPriorities: false,
    autoSuggestTags: false,
    cleanupOnCreate: false,
    insightsFrequency: "manual" as "daily" | "weekly" | "manual",
  });

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatus, setPullStatus] = useState("");
  const [pullController, setPullController] = useState<AbortController | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [_modelFetchError, setModelFetchError] = useState<string | null>(null);

  const fetchModels = useCallback(
    async (baseUrl: string, retryCount = 0) => {
      if (!baseUrl) return;

      setIsLoadingModels(true);
      setModelFetchError(null);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const tempConfig = { ...config, ollamaBaseUrl: sanitizeUrl(baseUrl) };
        storageService.set(STORAGE_KEYS.AI_CONFIG, tempConfig);

        const models = await aiService.listModels(controller.signal);
        setAvailableModels(models);

        if (models.length > 0 && !config.ollamaModel) {
          setConfig((prev) => ({ ...prev, ollamaModel: models[0] }));
        }
      } catch (e: any) {
        if (e.name === "AbortError") {
          setModelFetchError("Request timed out");
        } else {
          console.warn("Could not fetch Ollama models:", e);
          if (retryCount < 1) {
            setTimeout(() => fetchModels(baseUrl, retryCount + 1), 1000);
            return;
          }
          setModelFetchError(e.message || "Could not reach Ollama");
        }
        setAvailableModels([]);
      } finally {
        clearTimeout(timeoutId);
        setIsLoadingModels(false);
      }
    },
    [config],
  );

  useEffect(() => {
    const savedConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    if (savedConfig) {
      setConfig({ ...config, ...savedConfig });
      setAiManagement({
        autoDetectDuplicates: savedConfig.autoDetectDuplicates ?? false,
        autoSuggestPriorities: savedConfig.autoSuggestPriorities ?? false,
        autoSuggestTags: savedConfig.autoSuggestTags ?? false,
        cleanupOnCreate: savedConfig.cleanupOnCreate ?? false,
        insightsFrequency: savedConfig.insightsFrequency ?? "manual",
      });
      if (savedConfig.provider === "ollama" && savedConfig.ollamaBaseUrl) {
        fetchModels(savedConfig.ollamaBaseUrl);
      }
    } else {
      const oldKey = storageService.get<string>(STORAGE_KEYS.GEMINI_API_KEY, "");
      if (oldKey) {
        const migrated = { ...config, geminiApiKey: oldKey };
        setConfig(migrated);
        storageService.set(STORAGE_KEYS.AI_CONFIG, migrated);
      }
    }
  }, [config, fetchModels]);

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
    };
    storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
    setConfig(sanitizedConfig);
    addToast("AI configuration saved successfully", "success");
  };

  const handleTestConnection = async () => {
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
    } catch (e: any) {
      if (e.name === "AbortError") {
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
                <button
                  onClick={() => fetchModels(config.ollamaBaseUrl || "http://localhost:11434")}
                  disabled={isLoadingModels}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Refresh downloaded models"
                >
                  <RefreshCw size={14} className={isLoadingModels ? "animate-spin" : ""} />
                </button>
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
                <button
                  onClick={handlePullModel}
                  disabled={isPulling || !config.ollamaModel}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                  title="Download model from Ollama"
                >
                  {isPulling ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  <span className="text-xs font-bold hidden sm:inline">Pull</span>
                </button>
              </div>
              {availableModels.length === 0 && !isLoadingModels && (
                <p className="text-xs text-amber-500/70 mt-1 mt-2">
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

            <p className="text-xs text-slate-500">
              Ensure Ollama is running locally. You can download models using the "Pull" button or
              via CLI (
              <code className="bg-white/5 px-1 rounded">
                ollama pull {config.ollamaModel || "llama3.2"}
              </code>
              ).
            </p>
            <p className="text-xs text-slate-500">
              Test Connection checks the Ollama service, confirms the model is installed, and asks
              that model for a real response.
            </p>
          </div>
        )}

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={18} className="text-cyan-400" />
            <h4 className="text-sm font-bold text-white">AI Task Management</h4>
          </div>
          <p className="text-xs text-slate-400">
            Enable AI-powered task cleanup, organization, and insights.
          </p>

          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-3">
                <Merge
                  size={16}
                  className="text-slate-400 group-hover:text-cyan-400 transition-colors"
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">Auto-Detect Duplicates</div>
                  <div className="text-[10px] text-slate-500">
                    Scan for duplicate tasks when creating
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={aiManagement.autoDetectDuplicates}
                onChange={(e) =>
                  setAiManagement({
                    ...aiManagement,
                    autoDetectDuplicates: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded accent-cyan-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-3">
                <Zap
                  size={16}
                  className="text-slate-400 group-hover:text-cyan-400 transition-colors"
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">Auto-Suggest Priorities</div>
                  <div className="text-[10px] text-slate-500">
                    AI adjusts priorities based on context
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={aiManagement.autoSuggestPriorities}
                onChange={(e) =>
                  setAiManagement({
                    ...aiManagement,
                    autoSuggestPriorities: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded accent-cyan-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-3">
                <Tags
                  size={16}
                  className="text-slate-400 group-hover:text-cyan-400 transition-colors"
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">Auto-Suggest Tags</div>
                  <div className="text-[10px] text-slate-500">
                    AI recommends relevant tags for tasks
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={aiManagement.autoSuggestTags}
                onChange={(e) =>
                  setAiManagement({
                    ...aiManagement,
                    autoSuggestTags: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded accent-cyan-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-3">
                <Trash2
                  size={16}
                  className="text-slate-400 group-hover:text-cyan-400 transition-colors"
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">Cleanup on Create</div>
                  <div className="text-[10px] text-slate-500">
                    Run redundancy check after task creation
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={aiManagement.cleanupOnCreate}
                onChange={(e) =>
                  setAiManagement({
                    ...aiManagement,
                    cleanupOnCreate: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded accent-cyan-500"
              />
            </label>

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
                  setAiManagement({
                    ...aiManagement,
                    insightsFrequency: e.target.value as "daily" | "weekly" | "manual",
                  })
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

        <div className="flex gap-3">
          <button
            onClick={handleTestConnection}
            disabled={isTesting || isPulling}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold transition-all border border-white/10 disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : testResult === "success" ? (
              <CheckCircle2 size={18} className="text-emerald-500" />
            ) : testResult === "error" ? (
              <AlertCircle size={18} className="text-red-500" />
            ) : null}
            {isTesting ? "Testing..." : "Test Connection"}
          </button>
          <button
            onClick={handleSave}
            disabled={isPulling}
            className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-xl text-sm font-bold shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
          >
            Save Configuration
          </button>
        </div>

        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
          <CheckCircle2 size={12} />
          Your AI credentials and settings are stored locally on this device and never shared.
        </div>
      </div>
    </div>
  );
};
