// Type definitions for Advanced Filtering and Query Building

// Boolean operators for combining conditions
export type LogicOperator = 'AND' | 'OR';

// Comparison operators for individual fields
export type ComparisonOperator = 
    | 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'starts-with' | 'ends-with' 
    | 'greater-than' | 'less-than' | 'is-empty' | 'is-not-empty' | 'before' | 'after'
    | 'matches-regex';

// Fields available for filtering
export type FilterableField = 
    | 'title' 
    | 'description' 
    | 'assignee' 
    | 'priority' 
    | 'status' 
    | 'tags' 
    | 'dueDate' 
    | 'createdAt' 
    | 'customField';

// A single condition rule
export interface FilterRule {
    id: string;
    field: FilterableField;
    customFieldId?: string; // Only if field === 'customField'
    operator: ComparisonOperator;
    value: string | number | boolean | null;
}

// A group of rules combined by logic
export interface FilterGroup {
    id: string;
    operator: LogicOperator;
    rules: (FilterRule | FilterGroup)[]; // Recursive structure
}

// The root structure of a saved query
export interface AdvancedFilter {
    id: string;
    name: string;
    root: FilterGroup;
    isPublic?: boolean;
}
