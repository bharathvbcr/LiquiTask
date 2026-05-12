---
name: components
description: "Skill for the Components area of LiquiTask. 137 symbols across 38 files."
---

# Components

137 symbols | 38 files | Cohesion: 86%

## When to Use

- Working with code in `src/`
- Understanding how KeybindingProvider, handlePaste, getContext work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `components/TaskFormModal.tsx` | TaskFormModal, handleAddSubtask, handleUpdateSubtask, handleRemoveSubtask, toggleSubtask (+8) |
| `src/components/CommandPalette.tsx` | sortCandidates, groupByCategory, CommandPalette, getCategoryIcon, getCategoryLabel (+6) |
| `src/components/CalendarView.tsx` | CalendarView, navigate, isToday, isCurrentMonth, getPriorityColor (+4) |
| `src/components/AutoOrganizePanel.tsx` | applyPendingChanges, AutoOrganizePanel, toggleExpand, renderPreviewTab, renderHistoryTab (+3) |
| `src/components/InlineEditable.tsx` | handleSave, handleCancel, handleKeyDown, handleBlur, InlineSelect (+3) |
| `src/components/FilterBuilder.tsx` | genId, updateGroup, addRule, addGroup, removeRuleOrGroup (+2) |
| `src/services/aiService.ts` | refineTaskDraft, suggestMetadata, analyzeRedundancy, getOrganizeHistory, saveOrganizeHistory (+1) |
| `src/components/AIReorganizeModal.tsx` | AIReorganizeModal, toggleApproval, updateProjectName, applyApprovedClusters, getRandomColor |
| `src/components/SkeletonLoader.tsx` | getSkeletonKeys, SkeletonSidebar, SkeletonDashboardStats, SkeletonList, SkeletonLoader |
| `src/components/QuickAddBar.tsx` | handlePaste, parseQuickTask, QuickAddBar, handleSubmit |

## Entry Points

Start here when exploring this area:

- **`KeybindingProvider`** (Function) — `src/context/KeybindingContext.tsx:17`
- **`handlePaste`** (Function) — `src/components/QuickAddBar.tsx:144`
- **`getContext`** (Function) — `src/components/BulkAIOperationsModal.tsx:56`
- **`applyPendingChanges`** (Function) — `src/components/AutoOrganizePanel.tsx:156`
- **`AIReorganizeModal`** (Function) — `src/components/AIReorganizeModal.tsx:24`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `KeybindingProvider` | Function | `src/context/KeybindingContext.tsx` | 17 |
| `handlePaste` | Function | `src/components/QuickAddBar.tsx` | 144 |
| `getContext` | Function | `src/components/BulkAIOperationsModal.tsx` | 56 |
| `applyPendingChanges` | Function | `src/components/AutoOrganizePanel.tsx` | 156 |
| `AIReorganizeModal` | Function | `src/components/AIReorganizeModal.tsx` | 24 |
| `toggleApproval` | Function | `src/components/AIReorganizeModal.tsx` | 85 |
| `updateProjectName` | Function | `src/components/AIReorganizeModal.tsx` | 91 |
| `AIProjectAssignmentModal` | Function | `src/components/AIProjectAssignmentModal.tsx` | 26 |
| `toggleApproval` | Function | `src/components/AIProjectAssignmentModal.tsx` | 80 |
| `AIInsightsPanel` | Function | `src/components/AIInsightsPanel.tsx` | 40 |
| `handleSmartImport` | Function | `components/settings/DataSettings.tsx` | 77 |
| `TaskFormModal` | Function | `components/TaskFormModal.tsx` | 82 |
| `handleAddSubtask` | Function | `components/TaskFormModal.tsx` | 214 |
| `handleUpdateSubtask` | Function | `components/TaskFormModal.tsx` | 225 |
| `handleRemoveSubtask` | Function | `components/TaskFormModal.tsx` | 229 |
| `toggleSubtask` | Function | `components/TaskFormModal.tsx` | 233 |
| `handleSuggestMetadata` | Function | `components/TaskFormModal.tsx` | 281 |
| `handleAiRefine` | Function | `components/TaskFormModal.tsx` | 316 |
| `handleAddLink` | Function | `components/TaskFormModal.tsx` | 487 |
| `handleRemoveAttachment` | Function | `components/TaskFormModal.tsx` | 517 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `AutomationRuleEditor → SerializeDates` | cross_community | 9 |
| `HandleAiBreakdown → SerializeDates` | cross_community | 9 |
| `UseAppInitialization → SerializeDates` | cross_community | 8 |
| `HandleSuggestTimeEstimate → SerializeDates` | cross_community | 8 |
| `HandleSuggestMetadata → SerializeDates` | cross_community | 8 |
| `HandleExtractTasks → SerializeDates` | cross_community | 8 |
| `ApplyPendingChanges → SerializeDates` | cross_community | 8 |
| `AutoOrganizePanel → SerializeDates` | cross_community | 7 |
| `TaskCard → SerializeDates` | cross_community | 7 |
| `GanttView → SerializeDates` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 23 calls |

## How to Explore

1. `gitnexus_context({name: "KeybindingProvider"})` — see callers and callees
2. `gitnexus_query({query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
