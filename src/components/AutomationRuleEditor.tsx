import React, { useState, useEffect } from 'react';
import { AutomationRule, AutomationTrigger, AutomationAction } from '../services/automationService';
import { FilterGroup } from '../types/queryTypes';
import { FilterBuilder } from './FilterBuilder';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { Input } from './common/Input';

interface AutomationRuleEditorProps {
    rule: AutomationRule | null;
    onSave: (rule: AutomationRule) => void;
    onCancel: () => void;
    availablePriorities: Array<{ id: string; label: string }>;
    availableColumns: Array<{ id: string; title: string }>;
}

export const AutomationRuleEditor: React.FC<AutomationRuleEditorProps> = ({
    rule,
    onSave,
    onCancel,
    availablePriorities,
    availableColumns,
}) => {
    const [name, setName] = useState(rule?.name || '');
    const [enabled, setEnabled] = useState(rule?.enabled ?? true);
    const [trigger, setTrigger] = useState<AutomationTrigger>(rule?.trigger || 'onCreate');
    const [conditions, setConditions] = useState<FilterGroup>(rule?.conditions || { id: 'root', operator: 'AND', rules: [] });
    const [actions, setActions] = useState<Array<{ type: AutomationAction; field?: string; value: unknown }>>(
        rule?.actions || []
    );
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (rule) {
            setName(rule.name);
            setEnabled(rule.enabled);
            setTrigger(rule.trigger);
            setConditions(rule.conditions || { id: 'root', operator: 'AND', rules: [] });
            setActions(rule.actions || []);
        }
    }, [rule]);

    const handleAddAction = () => {
        setActions([...actions, { type: 'setField', field: 'priority', value: 'medium' }]);
    };

    const handleRemoveAction = (index: number) => {
        setActions(actions.filter((_, i) => i !== index));
    };

    const handleUpdateAction = (index: number, updates: Partial<typeof actions[0]>) => {
        const newActions = [...actions];
        newActions[index] = { ...newActions[index], ...updates };
        setActions(newActions);
    };

    const handleSave = () => {
        if (!name.trim()) {
            setErrors({ name: 'Rule name is required' });
            return;
        }

        const newRule: AutomationRule = {
            id: rule?.id || `rule-${Date.now()}`,
            name: name.trim(),
            enabled,
            trigger,
            conditions: conditions.rules.length > 0 ? conditions : undefined,
            actions,
        };

        onSave(newRule);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#0a0e17] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <h2 className="text-xl font-bold text-white">
                        {rule ? 'Edit Automation Rule' : 'Create Automation Rule'}
                    </h2>
                    <button
                        onClick={onCancel}
                        className="p-2 text-slate-400 hover:text-white transition-colors"
                        aria-label="Close automation rule editor"
                        title="Close"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="space-y-4">
                        <div>
                            <Input
                                label="Rule Name"
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    if (errors.name) setErrors({ ...errors, name: '' });
                                }}
                                placeholder="e.g., Auto-assign high priority tasks"
                                error={errors.name}
                            />
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={(e) => setEnabled(e.target.checked)}
                                    className="rounded"
                                    aria-label="Enable automation rule"
                                    title="Enable or disable this automation rule"
                                />
                                <label className="text-sm text-slate-300">Enabled</label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Trigger</label>
                                <select
                                    value={trigger}
                                    onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
                                    className="bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white focus:border-red-500/50 outline-none"
                                    aria-label="Automation trigger"
                                    title="Select when this automation rule should trigger"
                                >
                                    <option value="onCreate">On Task Create</option>
                                    <option value="onUpdate">On Task Update</option>
                                    <option value="onMove">On Task Move</option>
                                    <option value="onComplete">On Task Complete</option>
                                    <option value="onSchedule">On Schedule</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Conditions */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-medium text-slate-300">Conditions (Optional)</label>
                            <span className="text-xs text-slate-500">Leave empty to match all tasks</span>
                        </div>
                        <div className="bg-black/20 border border-white/10 rounded-lg p-4">
                            <FilterBuilder
                                rootGroup={conditions}
                                onChange={setConditions}
                                customFields={[]}
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-medium text-slate-300">Actions</label>
                            <button
                                onClick={handleAddAction}
                                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-sm transition-all"
                            >
                                <Plus size={14} />
                                Add Action
                            </button>
                        </div>

                        <div className="space-y-3">
                            {actions.map((action, index) => (
                                <div key={index} className="bg-black/20 border border-white/10 rounded-lg p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <select
                                            value={action.type}
                                            onChange={(e) => handleUpdateAction(index, { type: e.target.value as AutomationAction })}
                                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                            aria-label={`Action type for action ${index + 1}`}
                                            title="Select action type"
                                        >
                                            <option value="setField">Set Field</option>
                                            <option value="addTag">Add Tag</option>
                                            <option value="removeTag">Remove Tag</option>
                                            <option value="moveToColumn">Move to Column</option>
                                            <option value="setPriority">Set Priority</option>
                                            <option value="notify">Notify</option>
                                        </select>
                                        <button
                                            onClick={() => handleRemoveAction(index)}
                                            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                                            aria-label={`Remove action ${index + 1}`}
                                            title={`Remove action ${index + 1}`}
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </div>

                                    {action.type === 'setField' && (
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                value={action.field || ''}
                                                onChange={(e) => handleUpdateAction(index, { field: e.target.value })}
                                                placeholder="Field name (e.g., assignee)"
                                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                            />
                                            <input
                                                type="text"
                                                value={(action.value as string) || ''}
                                                onChange={(e) => handleUpdateAction(index, { value: e.target.value })}
                                                placeholder="Value"
                                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                            />
                                        </div>
                                    )}

                                    {(action.type === 'addTag' || action.type === 'removeTag') && (
                                        <input
                                            type="text"
                                            value={(action.value as string) || ''}
                                            onChange={(e) => handleUpdateAction(index, { value: e.target.value })}
                                            placeholder="Tag name"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                        />
                                    )}

                                    {action.type === 'moveToColumn' && (
                                        <select
                                            value={(action.value as string) || ''}
                                            onChange={(e) => handleUpdateAction(index, { value: e.target.value })}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                            aria-label="Select target column"
                                            title="Select the column to move tasks to"
                                        >
                                            <option value="">Select column</option>
                                            {availableColumns.map(col => (
                                                <option key={col.id} value={col.id}>{col.title}</option>
                                            ))}
                                        </select>
                                    )}

                                    {action.type === 'setPriority' && (
                                        <select
                                            value={(action.value as string) || ''}
                                            onChange={(e) => handleUpdateAction(index, { value: e.target.value })}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                            aria-label="Select priority"
                                            title="Select the priority to set"
                                        >
                                            <option value="">Select priority</option>
                                            {availablePriorities.map(prio => (
                                                <option key={prio.id} value={prio.id}>{prio.label}</option>
                                            ))}
                                        </select>
                                    )}

                                    {action.type === 'notify' && (
                                        <input
                                            type="text"
                                            value={(action.value as string) || ''}
                                            onChange={(e) => handleUpdateAction(index, { value: e.target.value })}
                                            placeholder="Notification message"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 outline-none"
                                        />
                                    )}
                                </div>
                            ))}

                            {actions.length === 0 && (
                                <p className="text-sm text-slate-500 text-center py-4">
                                    No actions defined. Add an action to execute when this rule triggers.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-800 text-white rounded-lg hover:shadow-lg transition-all flex items-center gap-2"
                    >
                        <Save size={16} />
                        Save Rule
                    </button>
                </div>
            </div>
        </div>
    );
};
