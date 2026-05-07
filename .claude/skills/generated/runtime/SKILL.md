---
name: runtime
description: "Skill for the Runtime area of LiquiTask. 5 symbols across 1 files."
---

# Runtime

5 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how getElectronAPI, getRuntimeWindowControls, getNativeStorageApi work
- Modifying runtime-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/runtime/runtimeEnvironment.ts` | getElectronAPI, getRuntimeWindowControls, getNativeStorageApi, hasElectronAPI, getRuntimeKind |

## Entry Points

Start here when exploring this area:

- **`getElectronAPI`** (Function) — `src/runtime/runtimeEnvironment.ts:18`
- **`getRuntimeWindowControls`** (Function) — `src/runtime/runtimeEnvironment.ts:48`
- **`getNativeStorageApi`** (Function) — `src/runtime/runtimeEnvironment.ts:76`
- **`hasElectronAPI`** (Function) — `src/runtime/runtimeEnvironment.ts:24`
- **`getRuntimeKind`** (Function) — `src/runtime/runtimeEnvironment.ts:32`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getElectronAPI` | Function | `src/runtime/runtimeEnvironment.ts` | 18 |
| `getRuntimeWindowControls` | Function | `src/runtime/runtimeEnvironment.ts` | 48 |
| `getNativeStorageApi` | Function | `src/runtime/runtimeEnvironment.ts` | 76 |
| `hasElectronAPI` | Function | `src/runtime/runtimeEnvironment.ts` | 24 |
| `getRuntimeKind` | Function | `src/runtime/runtimeEnvironment.ts` | 32 |

## How to Explore

1. `gitnexus_context({name: "getElectronAPI"})` — see callers and callees
2. `gitnexus_query({query: "runtime"})` — find related execution flows
3. Read key files listed above for implementation details
