---
name: cluster-24
description: "Skill for the Cluster_24 area of LiquiTask. 5 symbols across 1 files."
---

# Cluster_24

5 symbols | 1 files | Cohesion: 89%

## When to Use

- Working with code in `src/`
- Understanding how buildTaskContextIndex, addToIndex, getTasksFromContextIndex work
- Modifying cluster_24-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/utils/taskContextIndex.ts` | getContextKey, getTaskOrderValue, buildTaskContextIndex, addToIndex, getTasksFromContextIndex |

## Entry Points

Start here when exploring this area:

- **`buildTaskContextIndex`** (Function) — `src/utils/taskContextIndex.ts:18`
- **`addToIndex`** (Function) — `src/utils/taskContextIndex.ts:21`
- **`getTasksFromContextIndex`** (Function) — `src/utils/taskContextIndex.ts:44`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `buildTaskContextIndex` | Function | `src/utils/taskContextIndex.ts` | 18 |
| `addToIndex` | Function | `src/utils/taskContextIndex.ts` | 21 |
| `getTasksFromContextIndex` | Function | `src/utils/taskContextIndex.ts` | 44 |
| `getContextKey` | Function | `src/utils/taskContextIndex.ts` | 6 |
| `getTaskOrderValue` | Function | `src/utils/taskContextIndex.ts` | 9 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `BuildTaskContextIndex → SerializeDates` | cross_community | 6 |
| `BuildTaskContextIndex → IsAvailable` | cross_community | 4 |
| `BuildTaskContextIndex → SaveTasks` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 1 calls |

## How to Explore

1. `gitnexus_context({name: "buildTaskContextIndex"})` — see callers and callees
2. `gitnexus_query({query: "cluster_24"})` — find related execution flows
3. Read key files listed above for implementation details
