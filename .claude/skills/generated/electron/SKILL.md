---
name: electron
description: "Skill for the Electron area of LiquiTask. 9 symbols across 1 files."
---

# Electron

9 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `electron/`
- Understanding how isWorkspaceTextFile, isSkippedWorkspaceDirectory, createSnippet work
- Modifying electron-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/main.cts` | isWorkspaceTextFile, isSkippedWorkspaceDirectory, createSnippet, findWorkspaceFileMatches, getStorageFilePath (+4) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `isWorkspaceTextFile` | Function | `electron/main.cts` | 311 |
| `isSkippedWorkspaceDirectory` | Function | `electron/main.cts` | 317 |
| `createSnippet` | Function | `electron/main.cts` | 320 |
| `findWorkspaceFileMatches` | Function | `electron/main.cts` | 385 |
| `getStorageFilePath` | Function | `electron/main.cts` | 103 |
| `readStorage` | Function | `electron/main.cts` | 107 |
| `writeStorage` | Function | `electron/main.cts` | 122 |
| `isPathAuthorized` | Function | `electron/main.cts` | 285 |
| `resolveWorkspaceScope` | Function | `electron/main.cts` | 299 |

## How to Explore

1. `gitnexus_context({name: "isWorkspaceTextFile"})` — see callers and callees
2. `gitnexus_query({query: "electron"})` — find related execution flows
3. Read key files listed above for implementation details
