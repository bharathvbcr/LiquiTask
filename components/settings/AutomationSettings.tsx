import { Edit2, Plus, Trash2, Zap } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { AutomationRuleEditor } from "../../src/components/AutomationRuleEditor";
import { STORAGE_KEYS } from "../../src/constants";
import type { AutomationRule } from "../../src/services/automationService";
import { automationService } from "../../src/services/automationService";
import storageService from "../../src/services/storageService";
import type { BoardColumn, PriorityDefinition, ToastType } from "../../types";

interface AutomationSettingsProps {
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  addToast: (msg: string, type: ToastType) => void;
}

export const AutomationSettings: React.FC<AutomationSettingsProps> = ({
  columns,
  priorities,
  addToast,
}) => {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  useEffect(() => {
    const storedRules = storageService.get<AutomationRule[]>(STORAGE_KEYS.AUTOMATION_RULES, []);
    automationService.loadRules(storedRules);
    setRules(storedRules);
  }, []);

  const persistRules = (nextRules: AutomationRule[]) => {
    setRules(nextRules);
    storageService.set(STORAGE_KEYS.AUTOMATION_RULES, nextRules);
    automationService.loadRules(nextRules);
  };

  const handleSave = (rule: AutomationRule) => {
    const exists = rules.some((existing) => existing.id === rule.id);
    const nextRules = exists
      ? rules.map((existing) => (existing.id === rule.id ? rule : existing))
      : [...rules, rule];

    persistRules(nextRules);
    setIsEditorOpen(false);
    setEditingRule(null);
    addToast(exists ? "Automation rule updated" : "Automation rule created", "success");
  };

  const handleDelete = (ruleId: string) => {
    persistRules(rules.filter((rule) => rule.id !== ruleId));
    addToast("Automation rule deleted", "info");
  };

  const availableColumns = columns.map((column) => ({
    id: column.id,
    title: column.title,
  }));
  const availablePriorities = priorities.map((priority) => ({
    id: priority.id,
    label: priority.label,
  }));

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
            <Zap size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Automation Rules</h3>
            <p className="text-sm text-slate-400">Create rules that react to task changes.</p>
          </div>
        </div>
        <button
          onClick={() => {
            setEditingRule(null);
            setIsEditorOpen(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} />
          New Rule
        </button>
      </div>

      <div className="space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
            No automation rules configured.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{rule.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      rule.enabled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-500/15 text-slate-400"
                    }`}
                  >
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {rule.trigger} · {rule.actions.length} action
                  {rule.actions.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingRule(rule);
                    setIsEditorOpen(true);
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                  title="Edit rule"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                  title="Delete rule"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {isEditorOpen && (
        <AutomationRuleEditor
          rule={editingRule}
          onSave={handleSave}
          onCancel={() => {
            setIsEditorOpen(false);
            setEditingRule(null);
          }}
          availableColumns={availableColumns}
          availablePriorities={availablePriorities}
        />
      )}
    </div>
  );
};
