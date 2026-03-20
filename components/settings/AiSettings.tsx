import React, { useState, useEffect } from 'react';
import { Sparkles, Key, Globe, Server, CheckCircle2, AlertCircle, Loader2, Download } from 'lucide-react';
import storageService from '../../src/services/storageService';
import { STORAGE_KEYS } from '../../src/constants';
import { ToastType, AIConfig } from '../../types';
import { aiService } from '../../src/services/aiService';
import { sanitizeUrl } from '../../src/utils/validation';

interface AiSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
}

export const AiSettings: React.FC<AiSettingsProps> = ({ addToast }) => {
  const [config, setConfig] = useState<AIConfig>({
    provider: 'gemini',
    geminiApiKey: '',
    geminiModel: 'gemini-3.1-flash-lite',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: ''
  });
  
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatus, setPullStatus] = useState('');

  useEffect(() => {
    const savedConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    if (savedConfig) {
      setConfig({
          ...config,
          ...savedConfig
      });
    } else {
        // Migration from old key
        const oldKey = storageService.get<string>(STORAGE_KEYS.GEMINI_API_KEY, '');
        if (oldKey) {
            const migrated = { ...config, geminiApiKey: oldKey };
            setConfig(migrated);
            storageService.set(STORAGE_KEYS.AI_CONFIG, migrated);
        }
    }
  }, []);

  const handleSave = () => {
    const sanitizedConfig = {
      ...config,
      ollamaBaseUrl: sanitizeUrl(config.ollamaBaseUrl)
    };
    storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
    setConfig(sanitizedConfig);
    addToast('AI configuration saved successfully', 'success');
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // Temporarily save to test with sanitized URL
      const sanitizedConfig = {
        ...config,
        ollamaBaseUrl: sanitizeUrl(config.ollamaBaseUrl)
      };
      storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
      setConfig(sanitizedConfig);
      
      const result = await aiService.testProviderConnection();
      
      setTestResult(result.ok ? 'success' : 'error');
      if (result.ok) {
          addToast(result.message, 'success');
      } else {
          addToast(result.message, 'error');
      }
    } catch (e) {
      setTestResult('error');
      addToast((e as Error).message || 'Connection test failed', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handlePullModel = async () => {
    if (!config.ollamaModel) {
      addToast('Please enter a model name to pull', 'error');
      return;
    }

    setIsPulling(true);
    setPullProgress(0);
    setPullStatus('Starting pull...');
    
    try {
      // Save current config with sanitized URL
      const sanitizedConfig = {
        ...config,
        ollamaBaseUrl: sanitizeUrl(config.ollamaBaseUrl)
      };
      storageService.set(STORAGE_KEYS.AI_CONFIG, sanitizedConfig);
      setConfig(sanitizedConfig);
      
      await aiService.pullModel(config.ollamaModel, (status, percentage) => {
        setPullStatus(status);
        if (percentage !== undefined) setPullProgress(percentage);
      });
      
      addToast(`Successfully pulled ${config.ollamaModel}`, 'success');
      setTestResult('success');
    } catch (e) {
      addToast((e as Error).message || 'Failed to pull model', 'error');
    } finally {
      setIsPulling(false);
      setPullProgress(0);
      setPullStatus('');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
          <Sparkles size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">AI Integrations</h3>
          <p className="text-sm text-slate-400">Choose your AI provider to enable smart task creation and refinement.</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Provider Selector */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <label className="text-sm font-medium text-slate-300 mb-3 block">Active Provider</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setConfig({ ...config, provider: 'gemini' })}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${config.provider === 'gemini' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' : 'bg-black/20 border-white/10 text-slate-400 hover:border-white/20'}`}
            >
              <Globe size={18} />
              <div className="text-left">
                <div className="text-sm font-bold">Google Gemini</div>
                <div className="text-[10px] opacity-60">Cloud-based, reliable</div>
              </div>
            </button>
            <button
              onClick={() => setConfig({ ...config, provider: 'ollama' })}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${config.provider === 'ollama' ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-black/20 border-white/10 text-slate-400 hover:border-white/20'}`}
            >
              <Server size={18} />
              <div className="text-left">
                <div className="text-sm font-bold">Ollama</div>
                <div className="text-[10px] opacity-60">Local, private</div>
              </div>
            </button>
          </div>
        </div>

        {/* Gemini Settings */}
        {config.provider === 'gemini' && (
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
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Model Name</label>
              <input
                type="text"
                value={config.geminiModel}
                onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })}
                placeholder="e.g. gemini-3.1-flash-lite"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <p className="text-xs text-slate-500">
              Get your API key from <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Google AI Studio</a>, then paste the exact Gemini model name you want to use.
            </p>
          </div>
        )}

        {/* Ollama Settings */}
        {config.provider === 'ollama' && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Globe size={16} /> Ollama Base URL
              </label>
              <input
                type="text"
                value={config.ollamaBaseUrl}
                onChange={(e) => setConfig({ ...config, ollamaBaseUrl: e.target.value })}
                onBlur={(e) => setConfig({ ...config, ollamaBaseUrl: sanitizeUrl(e.target.value) })}
                placeholder="http://localhost:11434"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Server size={16} /> Model Name
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.ollamaModel}
                  onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                  placeholder="llama3, mistral, etc."
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handlePullModel}
                  disabled={isPulling || !config.ollamaModel}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-all disabled:opacity-50 flex items-center gap-2"
                  title="Download model from Ollama"
                >
                  {isPulling ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  <span className="text-xs font-bold">Pull</span>
                </button>
              </div>
            </div>

            {isPulling && (
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                  <span>{pullStatus}</span>
                  <span>{pullProgress}%</span>
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
              Ensure Ollama is running locally. You can download models using the "Pull" button or via CLI (<code className="bg-white/5 px-1 rounded">ollama pull {config.ollamaModel || 'llama3.2'}</code>).
            </p>
            <p className="text-xs text-slate-500">
              Test Connection checks the Ollama service, confirms the model is installed, and asks that model for a real response.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleTestConnection}
            disabled={isTesting || isPulling}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold transition-all border border-white/10 disabled:opacity-50"
          >
            {isTesting ? <Loader2 size={18} className="animate-spin" /> : testResult === 'success' ? <CheckCircle2 size={18} className="text-emerald-500" /> : testResult === 'error' ? <AlertCircle size={18} className="text-red-500" /> : null}
            {isTesting ? 'Testing...' : 'Test Connection'}
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
