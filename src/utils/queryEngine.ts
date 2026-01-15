import { Task } from '../../types';
import { FilterGroup, FilterRule } from '../types/queryTypes';

/**
 * Evaluating a single rule against a task.
 */
function evaluateRule(task: Task, rule: FilterRule): boolean {
    let taskValue: unknown;

    // 1. Resolve field value
    if (rule.field === 'customField' && rule.customFieldId) {
        taskValue = task.customFieldValues?.[rule.customFieldId];
    } else {
        switch (rule.field) {
            case 'title': taskValue = task.title; break;
            case 'description': taskValue = task.summary; break; // mapping summary to description
            case 'assignee': taskValue = task.assignee; break;
            case 'priority': taskValue = task.priority; break;
            case 'status': taskValue = task.status; break;
            case 'tags': taskValue = task.tags; break; // Array
            case 'dueDate': taskValue = task.dueDate; break;
            case 'createdAt': taskValue = task.createdAt; break;
            default: taskValue = undefined;
        }
    }

    // Handle null/undefined values
    if (taskValue === undefined || taskValue === null) {
        if (rule.operator === 'is-empty') return true;
        if (rule.operator === 'is-not-empty') return false;
        return false; // Default fail for null values
    }

    // 2. Evaluate operator
    const ruleValue = rule.value;

    // Date Handling
    if (rule.field === 'dueDate' || rule.field === 'createdAt') {
        const dateValue = new Date(taskValue as string | number | Date);
        const ruleDate = new Date(String(ruleValue as string | number | Date));

        if (isNaN(dateValue.getTime()) || isNaN(ruleDate.getTime())) return false;

        // Strip time for comparisons if ruleValue doesn't seem to have time? 
        // For now, simple timestamp comparison
        switch (rule.operator) {
            case 'before': return dateValue < ruleDate;
            case 'after': return dateValue > ruleDate;
            case 'equals': return dateValue.toDateString() === ruleDate.toDateString();
            default: return false;
        }
    }

    // Array Handling (Tags)
    if (Array.isArray(taskValue)) {
        const array = taskValue as string[];
        const strRuleValue = String(ruleValue).toLowerCase();

        switch (rule.operator) {
            case 'contains': return array.some(item => item.toLowerCase().includes(strRuleValue));
            case 'not-contains': return !array.some(item => item.toLowerCase().includes(strRuleValue));
            case 'equals': return array.some(item => item.toLowerCase() === strRuleValue);
            case 'is-empty': return array.length === 0;
            case 'is-not-empty': return array.length > 0;
            default: return false;
        }
    }

    // String/Number Handling
    const strTaskValue = String(taskValue).toLowerCase();
    const strRuleValue = String(ruleValue).toLowerCase();

    switch (rule.operator) {
        case 'contains': return strTaskValue.includes(strRuleValue);
        case 'not-contains': return !strTaskValue.includes(strRuleValue);
        case 'equals': return strTaskValue === strRuleValue;
        case 'not-equals': return strTaskValue !== strRuleValue;
        case 'starts-with': return strTaskValue.startsWith(strRuleValue);
        case 'ends-with': return strTaskValue.endsWith(strRuleValue);
        case 'is-empty': return strTaskValue.trim() === '';
        case 'is-not-empty': return strTaskValue.trim() !== '';
        case 'matches-regex': {
            try {
                const regex = new RegExp(String(ruleValue), 'i');
                return regex.test(String(taskValue));
            } catch (e) {
                return false; // Invalid regex
            }
        }
        // Numeric comparisons (attempt parse)
        case 'greater-than': return parseFloat(strTaskValue) > parseFloat(strRuleValue);
        case 'less-than': return parseFloat(strTaskValue) < parseFloat(strRuleValue);
        default: return false;
    }
}

/**
 * recursively evaluating a group of rules.
 */
function evaluateGroup(task: Task, group: FilterGroup): boolean {
    if (group.rules.length === 0) return true; // Empty group matches all? Or none? Usually all.

    if (group.operator === 'AND') {
        // All rules must be true
        return group.rules.every(ruleOrGroup => {
            if ('rules' in ruleOrGroup) {
                return evaluateGroup(task, ruleOrGroup as FilterGroup);
            } else {
                return evaluateRule(task, ruleOrGroup as FilterRule);
            }
        });
    } else { // OR
        // At least one rule must be true
        return group.rules.some(ruleOrGroup => {
            if ('rules' in ruleOrGroup) {
                return evaluateGroup(task, ruleOrGroup as FilterGroup);
            } else {
                return evaluateRule(task, ruleOrGroup as FilterRule);
            }
        });
    }
}

/**
 * Main entry point for filtering tasks.
 */
export function executeAdvancedFilter(tasks: Task[], filter: FilterGroup): Task[] {
    return tasks.filter(task => evaluateGroup(task, filter));
}
