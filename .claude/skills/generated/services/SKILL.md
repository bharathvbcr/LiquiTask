---
name: services
description: "Skill for the Services area of LiquiTask. 275 symbols across 43 files."
---

# Services

275 symbols | 43 files | Cohesion: 76%

## When to Use

- Working with code in `src/`
- Understanding how handleSuggestTimeEstimate, BulkAIOperationsModal, runOperation work
- Modifying services-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/services/aiService.ts` | stripTaskData, AIProvider, refineTask, GeminiProvider, refineTask (+57) |
| `src/services/indexedDBService.ts` | deleteTask, delete, isAvailable, saveTasks, saveColumns (+18) |
| `src/services/taskCleanupService.ts` | detectDuplicates, suggestMerge, heuristicMergeSuggestion, heuristicDuplicateDetection, calculateTitleSimilarity (+12) |
| `src/services/searchIndexService.ts` | getRelevantContext, rankTasksForContext, search, searchWithRegex, checkMap (+9) |
| `src/services/autoOrganizeService.ts` | getContext, getConfig, filterTasks, runAutoOrganize, runDeduplication (+8) |
| `src/services/storageService.ts` | set, parseTasks, initialize, runDataMigrations, saveAllData (+5) |
| `src/services/migrationService.ts` | constructor, loadBackupsFromStorage, needsMigration, runMigrations, saveBackupsToStorage (+5) |
| `src/services/recurringTaskService.ts` | calculateNextOccurrence, updateNextOccurrence, RecurringTaskService, initializeRecurringTaskService, getRecurringTaskService (+5) |
| `src/services/automationService.ts` | clearSchedulerContext, stop, addRule, updateRule, deleteRule (+5) |
| `src/services/exportService.ts` | exportToCSV, formatColumnHeader, getTaskValue, escapeCSV, downloadCSV (+5) |

## Entry Points

Start here when exploring this area:

- **`handleSuggestTimeEstimate`** (Function) — `components/TaskFormModal.tsx:238`
- **`BulkAIOperationsModal`** (Function) — `src/components/BulkAIOperationsModal.tsx:40`
- **`runOperation`** (Function) — `src/components/BulkAIOperationsModal.tsx:199`
- **`AIMergeDuplicatesModal`** (Function) — `src/components/AIMergeDuplicatesModal.tsx:23`
- **`toggleApproval`** (Function) — `src/components/AIMergeDuplicatesModal.tsx:88`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `RecurringTaskService` | Class | `src/services/recurringTaskService.ts` | 10 |
| `handleSuggestTimeEstimate` | Function | `components/TaskFormModal.tsx` | 238 |
| `BulkAIOperationsModal` | Function | `src/components/BulkAIOperationsModal.tsx` | 40 |
| `runOperation` | Function | `src/components/BulkAIOperationsModal.tsx` | 199 |
| `AIMergeDuplicatesModal` | Function | `src/components/AIMergeDuplicatesModal.tsx` | 23 |
| `toggleApproval` | Function | `src/components/AIMergeDuplicatesModal.tsx` | 88 |
| `getStorageQuotaInfo` | Function | `src/utils/storageQuota.ts` | 18 |
| `isStorageNearQuota` | Function | `src/utils/storageQuota.ts` | 51 |
| `trySaveToStorage` | Function | `src/utils/storageQuota.ts` | 61 |
| `debounce` | Function | `src/utils/debounce.ts` | 4 |
| `useSearchHistory` | Function | `src/hooks/useSearchHistory.ts` | 13 |
| `useProjectController` | Function | `src/hooks/useProjectController.ts` | 12 |
| `handleUnarchive` | Function | `src/components/ArchiveView.tsx` | 43 |
| `handleDelete` | Function | `src/components/ArchiveView.tsx` | 52 |
| `runOrganize` | Function | `src/components/AutoOrganizePanel.tsx` | 133 |
| `handleAiBreakdown` | Function | `components/TaskFormModal.tsx` | 422 |
| `useTaskController` | Function | `src/hooks/useTaskController.ts` | 112 |
| `getMigrationsFrom` | Function | `src/migrations/index.ts` | 47 |
| `compareVersions` | Function | `src/migrations/index.ts` | 55 |
| `loadData` | Function | `src/hooks/useAppInitialization.ts` | 146 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `AutomationRuleEditor → SerializeDates` | cross_community | 9 |
| `HandleAiBreakdown → SerializeDates` | cross_community | 9 |
| `HandleSave → EvaluateRule` | cross_community | 9 |
| `UseTaskController → SerializeDates` | cross_community | 8 |
| `UseAppInitialization → SerializeDates` | cross_community | 8 |
| `UseTaskAssistant → SerializeDates` | cross_community | 8 |
| `AutomationSettings → EvaluateRule` | cross_community | 8 |
| `AutomationSettings → DeserializeDates` | cross_community | 8 |
| `HandleSuggestTimeEstimate → SerializeDates` | cross_community | 8 |
| `HandleSuggestMetadata → SerializeDates` | cross_community | 8 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Components | 18 calls |
| Hooks | 7 calls |
| Settings | 3 calls |

## How to Explore

1. `gitnexus_context({name: "handleSuggestTimeEstimate"})` — see callers and callees
2. `gitnexus_query({query: "services"})` — find related execution flows
3. Read key files listed above for implementation details
