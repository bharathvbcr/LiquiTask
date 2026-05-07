---
name: electron
description: "Skill for the Electron area of LiquiTask. 7 symbols across 1 files."
---

# Electron

7 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `electron/`
- Understanding how getStorageFilePath, readStorage, writeStorage work
- Modifying electron-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/main.cts` | getStorageFilePath, readStorage, writeStorage, isPathAuthorized, resolveWorkspaceScope (+2) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getStorageFilePath` | Function | `electron/main.cts` | 26 |
| `readStorage` | Function | `electron/main.cts` | 30 |
| `writeStorage` | Function | `electron/main.cts` | 45 |
| `isPathAuthorized` | Function | `electron/main.cts` | 208 |
| `resolveWorkspaceScope` | Function | `electron/main.cts` | 222 |
| `createSnippet` | Function | `electron/main.cts` | 236 |
| `findMarkdownMatches` | Function | `electron/main.cts` | 289 |

## How to Explore

1. `gitnexus_context({name: "getStorageFilePath"})` — see callers and callees
2. `gitnexus_query({query: "electron"})` — find related execution flows
3. Read key files listed above for implementation details
