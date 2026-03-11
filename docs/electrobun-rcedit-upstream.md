# ElectroBun Windows `rcedit` fix

## Problem

ElectroBun `1.15.1` can package on Windows but icon embedding resolves `rcedit` from a baked CI path such as:

`D:\a\electrobun\electrobun\package\node_modules\rcedit\bin\rcedit-x64.exe`

That path does not exist in normal local installs, so icon embedding falls back to warnings and drops branding during packaging.

## Local repo workaround

This repo keeps the workaround outside `node_modules`:

- `scripts/electrobun.cjs`
- `.electrobun-shims/powershell.cmd`

The local wrapper does two things:

- materializes a local patched copy of ElectroBun's TypeScript CLI using the shipped `src/cli` and `dist/api/shared` files so Windows icon embedding resolves the locally installed `rcedit`
- routes ElectroBun package commands through a PowerShell shim that avoids blocked local profile loading during archive creation

Commands that do not need the packaging fix, such as `init`, can still be delegated to ElectroBun's stock launcher.

## PR-ready upstream change

The upstream code change should live in `src/cli/index.ts` and replace `await import("rcedit")` in the Windows icon-embedding paths with local package resolution.

Implementation shape:

1. Resolve `rcedit/package.json` from the project root dependency tree.
2. Derive the package directory from that resolved path.
3. Choose `bin/rcedit-x64.exe` first, then fallback to `bin/rcedit.exe`.
4. Execute the resolved binary directly for `--set-icon`.
5. Keep the existing PNG-to-ICO conversion and warning-only failure handling.

Once ElectroBun rebuilds and republishes its Windows CLI binary from that source fix, the local wrapper can be dropped and the package scripts can call ElectroBun directly again.
