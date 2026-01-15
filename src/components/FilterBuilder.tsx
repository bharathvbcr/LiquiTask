import React from 'react';
import { FilterGroup, FilterRule, ComparisonOperator, FilterableField } from '../types/queryTypes';
import { CustomFieldDefinition } from '../../types';
import { Plus, Trash2, X } from 'lucide-react';

interface FilterBuilderProps {
    rootGroup: FilterGroup;
    onChange: (newGroup: FilterGroup) => void;
    customFields: CustomFieldDefinition[];
}

const FIELD_OPTIONS: { value: FilterableField; label: string; type: 'text' | 'date' | 'select' | 'array' }[] = [
    { value: 'title', label: 'Title', type: 'text' },
    { value: 'description', label: 'Description', type: 'text' },
    { value: 'assignee', label: 'Assignee', type: 'text' },
    { value: 'priority', label: 'Priority', type: 'select' },
    { value: 'status', label: 'Status', type: 'select' },
    { value: 'tags', label: 'Tags', type: 'array' },
    { value: 'dueDate', label: 'Due Date', type: 'date' },
    { value: 'createdAt', label: 'Created Date', type: 'date' },
];

const OPERATORS_BY_TYPE: Record<string, ComparisonOperator[]> = {
    text: ['contains', 'not-contains', 'equals', 'not-equals', 'starts-with', 'ends-with', 'is-empty', 'is-not-empty', 'matches-regex'],
    date: ['before', 'after', 'equals', 'is-empty', 'is-not-empty'],
    select: ['equals', 'not-equals', 'is-empty', 'is-not-empty'],
    array: ['contains', 'not-contains', 'is-empty', 'is-not-empty'],
    number: ['equals', 'not-equals', 'greater-than', 'less-than', 'is-empty', 'is-not-empty'],
};

export const FilterBuilder: React.FC<FilterBuilderProps> = ({ rootGroup, onChange, customFields }) => {
    
    // Helper to generate IDs
    const genId = () => Math.random().toString(36).substr(2, 9);

    const updateGroup = (groupId: string, updater: (group: FilterGroup) => FilterGroup) => {
        const recursiveUpdate = (currentGroup: FilterGroup): FilterGroup => {
            if (currentGroup.id === groupId) {
                return updater(currentGroup);
            }
            return {
                ...currentGroup,
                rules: currentGroup.rules.map(r => {
                    if ('rules' in r) return recursiveUpdate(r);
                    return r;
                })
            };
        };
        onChange(recursiveUpdate(rootGroup));
    };

    const addRule = (groupId: string) => {
        updateGroup(groupId, (g) => ({
            ...g,
            rules: [...g.rules, { id: genId(), field: 'title', operator: 'contains', value: '' }]
        }));
    };

    const addGroup = (groupId: string) => {
        updateGroup(groupId, (g) => ({
            ...g,
            rules: [...g.rules, { id: genId(), operator: 'AND', rules: [{ id: genId(), field: 'title', operator: 'contains', value: '' }] }]
        }));
    };

    const removeRuleOrGroup = (parentId: string, itemId: string) => {
        updateGroup(parentId, (g) => ({
            ...g,
            rules: g.rules.filter(r => r.id !== itemId)
        }));
    };

    const updateRule = (ruleId: string, updates: Partial<FilterRule>) => {
        const recursiveUpdate = (currentGroup: FilterGroup): FilterGroup => {
            return {
                ...currentGroup,
                rules: currentGroup.rules.map(r => {
                    if ('rules' in r) return recursiveUpdate(r);
                    if (r.id === ruleId) return { ...r, ...updates };
                    return r;
                })
            };
        };
        onChange(recursiveUpdate(rootGroup));
    };

    // Recursive component for rendering groups
    const GroupRenderer: React.FC<{ group: FilterGroup; depth?: number; parentId?: string }> = ({ group, depth = 0, parentId }) => {
        return (
            <div className={`flex flex-col gap-2 p-3 rounded-lg border ${depth === 0 ? 'border-none p-0' : 'bg-white/5 border-white/10 ml-4'}`}>
                
                {/* Group Header */}
                <div className="flex items-center gap-2 mb-2">
                    <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/10">
                        <button
                            onClick={() => updateGroup(group.id, g => ({ ...g, operator: 'AND' }))}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${group.operator === 'AND' ? 'bg-red-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            AND
                        </button>
                        <button
                            onClick={() => updateGroup(group.id, g => ({ ...g, operator: 'OR' }))}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${group.operator === 'OR' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            OR
                        </button>
                    </div>
                    
                    {parentId && (
                        <button 
                            onClick={() => removeRuleOrGroup(parentId, group.id)} 
                            className="p-1.5 text-slate-500 hover:text-red-400 rounded transition-colors ml-auto"
                            aria-label="Remove filter group"
                            title="Remove filter group"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>

                {/* Rules & Subgroups */}
                <div className="space-y-2">
                    {group.rules.map((item) => {
                        if ('rules' in item) {
                            return <GroupRenderer key={item.id} group={item} depth={depth + 1} parentId={group.id} />;
                        } else {
                            return (
                                <div key={item.id} className="flex flex-wrap items-center gap-2 p-2 bg-black/20 rounded border border-white/5 group-hover:border-white/10">
                                    {/* Field Selector */}
                                    <label htmlFor={`field-select-${item.id}`} className="sr-only">
                                        Filter field
                                    </label>
                                    <select
                                        id={`field-select-${item.id}`}
                                        value={item.field === 'customField' ? `cf:${item.customFieldId}` : item.field}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val.startsWith('cf:')) {
                                                updateRule(item.id, { field: 'customField', customFieldId: val.split(':')[1], operator: 'contains', value: '' });
                                            } else {
                                                updateRule(item.id, { field: val as FilterableField, customFieldId: undefined, operator: OPERATORS_BY_TYPE[FIELD_OPTIONS.find(f => f.value === val)?.type || 'text'][0], value: '' });
                                            }
                                        }}
                                        aria-label="Filter field"
                                        className="bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-300 focus:border-red-500/50 outline-none max-w-[120px]"
                                    >
                                        <optgroup label="Standard Fields">
                                            {FIELD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </optgroup>
                                        {customFields.length > 0 && (
                                            <optgroup label="Custom Fields">
                                                {customFields.map(cf => <option key={cf.id} value={`cf:${cf.id}`}>{cf.label}</option>)}
                                            </optgroup>
                                        )}
                                    </select>

                                    {/* Operator Selector */}
                                    <label htmlFor={`operator-select-${item.id}`} className="sr-only">
                                        Comparison operator
                                    </label>
                                    <select
                                        id={`operator-select-${item.id}`}
                                        value={item.operator}
                                        onChange={(e) => updateRule(item.id, { operator: e.target.value as ComparisonOperator })}
                                        aria-label="Comparison operator"
                                        className="bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-300 focus:border-red-500/50 outline-none max-w-[120px]"
                                    >
                                        {(() => {
                                            const fieldType = item.field === 'customField' 
                                                ? (customFields.find(c => c.id === item.customFieldId)?.type === 'number' ? 'number' : 'text')
                                                : (FIELD_OPTIONS.find(f => f.value === item.field)?.type || 'text');
                                            
                                            return OPERATORS_BY_TYPE[fieldType]?.map(op => (
                                                <option key={op} value={op}>{op.replace(/-/g, ' ')}</option>
                                            ));
                                        })()}
                                    </select>

                                    {/* Value Input */}
                                    {!['is-empty', 'is-not-empty'].includes(item.operator) && (
                                        <input
                                            type={item.field === 'dueDate' || item.field === 'createdAt' ? 'date' : 'text'}
                                            value={String(item.value || '')}
                                            onChange={(e) => updateRule(item.id, { value: e.target.value })}
                                            className="flex-1 bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-300 focus:border-red-500/50 outline-none min-w-[100px]"
                                            placeholder="Value..."
                                        />
                                    )}

                                    <button 
                                        onClick={() => removeRuleOrGroup(group.id, item.id)} 
                                        className="p-1.5 text-slate-600 hover:text-red-400 transition-colors ml-auto"
                                        aria-label="Remove filter rule"
                                        title="Remove filter rule"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            );
                        }
                    })}
                </div>

                {/* Add Actions */}
                <div className="flex gap-2 mt-2">
                    <button onClick={() => addRule(group.id)} className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded border border-white/5 transition-colors">
                        <Plus size={12} /> Add Rule
                    </button>
                    {depth < 2 && ( // Limit nesting depth
                        <button onClick={() => addGroup(group.id)} className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded border border-white/5 transition-colors">
                            <FolderOpenIcon size={12} /> Add Group
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return <GroupRenderer group={rootGroup} />;
};

const FolderOpenIcon = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
);
