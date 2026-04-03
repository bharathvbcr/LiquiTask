import {
  AlertTriangle,
  BarChart3,
  Brain,
  Clock,
  Lightbulb,
  Loader2,
  RefreshCw,
  TrendingUp,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { AIContext, AIInsight, PriorityDefinition, Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "../services/aiService";
import storageService from "../services/storageService";

interface AIInsightsPanelProps {
  allTasks: Task[];
  isOpen: boolean;
  onClose: () => void;
}

const _iconMap = {
  productivity: TrendingUp,
  bottleneck: AlertTriangle,
  "estimate-accuracy": Clock,
  pattern: BarChart3,
  recommendation: Lightbulb,
};

const colorMap = {
  productivity: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  bottleneck: "text-red-400 bg-red-500/10 border-red-500/20",
  "estimate-accuracy": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  pattern: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  recommendation: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
};

export const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({ allTasks, isOpen, onClose }) => {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
      const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
      const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");

      const context: AIContext = { activeProjectId, projects, priorities };
      const generated = await aiService.generateInsights(allTasks, context);
      setInsights(generated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate insights");
    } finally {
      setIsLoading(false);
    }
  }, [allTasks]);

  useEffect(() => {
    if (isOpen && allTasks.length > 0) {
      loadInsights();
    }
  }, [isOpen, allTasks.length, loadInsights]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-in zoom-in-95">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Brain size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">AI Insights</h2>
              <p className="text-xs text-slate-400">Intelligent analysis of your tasks</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadInsights}
              disabled={isLoading}
              className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh insights"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-cyan-400" />
              <span className="ml-3 text-slate-400">Generating AI insights...</span>
            </div>
          ) : insights.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Brain size={48} className="mx-auto mb-4 opacity-50" />
              <p>No insights available. Try adding more tasks.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {insights.map((insight) => (
                <div
                  key={insight.id}
                  className={`p-4 rounded-xl border ${colorMap[insight.type as keyof typeof colorMap] || colorMap.recommendation}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-sm">{insight.title}</h3>
                    <span className="text-[10px] uppercase tracking-wider opacity-70">
                      {insight.type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{insight.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
