---
name: hooks
description: "Skill for the Hooks area of LiquiTask. 30 symbols across 15 files."
---

# Hooks

30 symbols | 15 files | Cohesion: 87%

## When to Use

- Working with code in `src/`
- Understanding how removeFromMap, useTaskAssistant, isCurrentRun work
- Modifying hooks-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/hooks/useTaskAssistant.ts` | normalizeToolValue, getToolCallSignature, withTimeout, formatAssistantError, useTaskAssistant (+1) |
| `src/services/searchIndexService.ts` | updateTask, removeTask, removeFromMap, addTask, addToIndex |
| `src/hooks/useSavedViews.ts` | useSavedViews, getDefaultViews, getWeekStart, getWeekEnd |
| `src/hooks/useTimer.ts` | useTimer, formatMinutes, secondsToMinutes |
| `src/components/TimeTracker.tsx` | TimeTracker, handleSave |
| `src/components/TaskQuickView.tsx` | TaskQuickView |
| `src/hooks/useBulkSelection.ts` | useBulkSelection |
| `src/hooks/useBoardKeyboardNav.ts` | useBoardKeyboardNav |
| `src/components/ProjectBoard.tsx` | ProjectBoard |
| `src/utils/taskToJson.ts` | taskToJson |

## Entry Points

Start here when exploring this area:

- **`removeFromMap`** (Function) — `src/services/searchIndexService.ts:205`
- **`useTaskAssistant`** (Function) — `src/hooks/useTaskAssistant.ts:93`
- **`isCurrentRun`** (Function) — `src/hooks/useTaskAssistant.ts:256`
- **`useTimer`** (Function) — `src/hooks/useTimer.ts:19`
- **`formatMinutes`** (Function) — `src/hooks/useTimer.ts:128`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `removeFromMap` | Function | `src/services/searchIndexService.ts` | 205 |
| `useTaskAssistant` | Function | `src/hooks/useTaskAssistant.ts` | 93 |
| `isCurrentRun` | Function | `src/hooks/useTaskAssistant.ts` | 256 |
| `useTimer` | Function | `src/hooks/useTimer.ts` | 19 |
| `formatMinutes` | Function | `src/hooks/useTimer.ts` | 128 |
| `secondsToMinutes` | Function | `src/hooks/useTimer.ts` | 139 |
| `TimeTracker` | Function | `src/components/TimeTracker.tsx` | 12 |
| `handleSave` | Function | `src/components/TimeTracker.tsx` | 29 |
| `TaskQuickView` | Function | `src/components/TaskQuickView.tsx` | 13 |
| `useSavedViews` | Function | `src/hooks/useSavedViews.ts` | 7 |
| `useBulkSelection` | Function | `src/hooks/useBulkSelection.ts` | 19 |
| `useBoardKeyboardNav` | Function | `src/hooks/useBoardKeyboardNav.ts` | 35 |
| `ProjectBoard` | Function | `src/components/ProjectBoard.tsx` | 65 |
| `taskToJson` | Function | `src/utils/taskToJson.ts` | 6 |
| `useTaskCardContextMenu` | Function | `src/hooks/useTaskCardContextMenu.ts` | 11 |
| `useVirtualTaskList` | Function | `src/hooks/useVirtualScroll.ts` | 8 |
| `SortableColumn` | Function | `src/components/board/SortableColumn.tsx` | 30 |
| `useFocusTrap` | Function | `src/hooks/useFocusTrap.ts` | 12 |
| `Modal` | Function | `src/components/common/Modal.tsx` | 16 |
| `updateTask` | Method | `src/services/searchIndexService.ts` | 194 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `UseTaskController → SerializeDates` | cross_community | 8 |
| `UseTaskAssistant → SerializeDates` | cross_community | 8 |
| `UseTaskController → IsAvailable` | cross_community | 6 |
| `UseTaskController → SaveTasks` | cross_community | 6 |
| `UseTaskAssistant → IsAvailable` | cross_community | 6 |
| `UseTaskAssistant → SaveTasks` | cross_community | 6 |
| `UseTaskController → RemoveFromMap` | cross_community | 4 |
| `UseTaskController → Tokenize` | cross_community | 4 |
| `App → GetWeekStart` | cross_community | 4 |
| `App → GetWeekEnd` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 3 calls |

## How to Explore

1. `gitnexus_context({name: "removeFromMap"})` — see callers and callees
2. `gitnexus_query({query: "hooks"})` — find related execution flows
3. Read key files listed above for implementation details
