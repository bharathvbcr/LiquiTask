import { Edit2, Plus, Trash2, Zap } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { AutomationRuleEditor } from "../AutomationRuleEditor";
import { Button } from "../common/Button";
import { STORAGE_KEYS } from "../../constants";
import { useConfirmation } from "../../contexts/ConfirmationContext";
import type { AutomationRule } from "../../services/automationService";
import { automationService } from "../../services/automationService";
import agentService from "../../services/agents/agentService";
import { persistStorageQuiet } from "../../utils/persistStorage";
import storageService from "../../services/storageService";
import type { BoardColumn, PriorityDefinition, ToastType } from "../../../types";
import { SettingsToggle } from "./SettingsToggle";

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
  const { confirm } = useConfirmation();
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
    persistStorageQuiet(STORAGE_KEYS.AUTOMATION_RULES, nextRules, (message) => {
      addToast(`Failed to save automation rules: ${message}`, "error");
    });
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

  const handleDelete = async (rule: AutomationRule) => {
    const ok = await confirm({
      title: "Delete automation rule",
      message: `Delete "${rule.name}"? This cannot be undone.`,
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    persistRules(rules.filter((r) => r.id !== rule.id));
    addToast("Automation rule deleted", "info");
  };

  const toggleRule = (ruleId: string, enabled: boolean) => {
    persistRules(
      rules.map((rule) => (rule.id === ruleId ? { ...rule, enabled } : rule)),
    );
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
            <Zap size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Automation Rules</h3>
            <p className="text-sm text-slate-400">Create rules that react to task changes.</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingRule(null);
            setIsEditorOpen(true);
          }}
          icon={<Plus size={16} />}
        >
          New Rule
        </Button>
      </div>

      <div className="space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-8 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Zap size={20} className="text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-slate-300 font-medium">No automation rules yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Automate task moves, priority changes, and more when events occur.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setEditingRule(null);
                setIsEditorOpen(true);
              }}
              icon={<Plus size={14} />}
            >
              Create your first rule
            </Button>
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${
                rule.enabled
                  ? "border-white/10 bg-white/5"
                  : "border-white/5 bg-white/[0.02] opacity-70"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate">{rule.name}</span>
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
              <div className="flex items-center gap-2 shrink-0">
                <SettingsToggle
                  checked={rule.enabled}
                  onChange={(enabled) => toggleRule(rule.id, enabled)}
                  color="amber"
                  aria-label={`Toggle ${rule.name}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setEditingRule(rule);
                    setIsEditorOpen(true);
                  }}
                  aria-label={`Edit ${rule.name}`}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(rule)}
                  aria-label={`Delete ${rule.name}`}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
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
          availableAgents={agentService.getAgents().map((a) => ({ id: a.id, name: a.name }))}
        />
      )}
    </div>
  );
};
