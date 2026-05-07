---
name: settings
description: "Skill for the Settings area of LiquiTask. 20 symbols across 5 files."
---

# Settings

20 symbols | 5 files | Cohesion: 81%

## When to Use

- Working with code in `components/`
- Understanding how sanitizeUrl, isValidUrl, AiSettings work
- Modifying settings-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `components/settings/PrioritySettings.tsx` | PrioritySettings, handleUpdatePriority, handleDeletePriority, handleMoveUp, handleMoveDown (+2) |
| `components/settings/AiSettings.tsx` | AiSettings, handleSave, handlePullModel, handleOllamaUrlBlur, updateAutoOrganizeOperation (+1) |
| `components/settings/AutomationSettings.tsx` | AutomationSettings, persistRules, handleSave, handleDelete |
| `src/utils/validation.ts` | sanitizeUrl, isValidUrl |
| `src/services/automationService.ts` | loadRules |

## Entry Points

Start here when exploring this area:

- **`sanitizeUrl`** (Function) — `src/utils/validation.ts:168`
- **`isValidUrl`** (Function) — `src/utils/validation.ts:180`
- **`AiSettings`** (Function) — `components/settings/AiSettings.tsx:48`
- **`handleSave`** (Function) — `components/settings/AiSettings.tsx:185`
- **`handlePullModel`** (Function) — `components/settings/AiSettings.tsx:229`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `sanitizeUrl` | Function | `src/utils/validation.ts` | 168 |
| `isValidUrl` | Function | `src/utils/validation.ts` | 180 |
| `AiSettings` | Function | `components/settings/AiSettings.tsx` | 48 |
| `handleSave` | Function | `components/settings/AiSettings.tsx` | 185 |
| `handlePullModel` | Function | `components/settings/AiSettings.tsx` | 229 |
| `handleOllamaUrlBlur` | Function | `components/settings/AiSettings.tsx` | 279 |
| `updateAutoOrganizeOperation` | Function | `components/settings/AiSettings.tsx` | 285 |
| `handleRemoveWorkspacePath` | Function | `components/settings/AiSettings.tsx` | 310 |
| `PrioritySettings` | Function | `components/settings/PrioritySettings.tsx` | 56 |
| `handleUpdatePriority` | Function | `components/settings/PrioritySettings.tsx` | 79 |
| `handleDeletePriority` | Function | `components/settings/PrioritySettings.tsx` | 83 |
| `handleMoveUp` | Function | `components/settings/PrioritySettings.tsx` | 92 |
| `handleMoveDown` | Function | `components/settings/PrioritySettings.tsx` | 99 |
| `handleReset` | Function | `components/settings/PrioritySettings.tsx` | 118 |
| `AutomationSettings` | Function | `components/settings/AutomationSettings.tsx` | 16 |
| `persistRules` | Function | `components/settings/AutomationSettings.tsx` | 31 |
| `handleSave` | Function | `components/settings/AutomationSettings.tsx` | 37 |
| `handleDelete` | Function | `components/settings/AutomationSettings.tsx` | 49 |
| `loadRules` | Method | `src/services/automationService.ts` | 50 |
| `getDefaultPriorities` | Function | `components/settings/PrioritySettings.tsx` | 393 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HandleSave → EvaluateRule` | cross_community | 9 |
| `AutomationSettings → EvaluateRule` | cross_community | 8 |
| `AutomationSettings → DeserializeDates` | cross_community | 8 |
| `AutomationRuleEditor → SanitizeUrl` | cross_community | 7 |
| `AutomationSettings → SerializeDates` | cross_community | 7 |
| `HandleAiBreakdown → SanitizeUrl` | cross_community | 7 |
| `HandleSave → DeserializeDates` | cross_community | 7 |
| `AiSettings → SerializeDates` | cross_community | 6 |
| `AutomationSettings → IsRuleDue` | cross_community | 6 |
| `HandleSuggestTimeEstimate → SanitizeUrl` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 5 calls |
| Components | 2 calls |

## How to Explore

1. `gitnexus_context({name: "sanitizeUrl"})` — see callers and callees
2. `gitnexus_query({query: "settings"})` — find related execution flows
3. Read key files listed above for implementation details
