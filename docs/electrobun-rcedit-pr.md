# ElectroBun PR draft

## Title

Fix Windows `rcedit` resolution for icon embedding

## Summary

This changes the Windows icon embedding paths to resolve `rcedit` from the local installed dependency tree instead of relying on a baked CI/snapshot path.

## Problem

On Windows, `electrobun@1.15.1` can attempt to execute `rcedit` from a path like:

`D:\a\electrobun\electrobun\package\node_modules\rcedit\bin\rcedit-x64.exe`

That path does not exist in normal local app installs, which causes icon embedding to fail even though packaging otherwise continues.

## Change

This PR updates the Windows icon embedding code in `src/cli/index.ts` to:

1. Resolve `rcedit/package.json` from the local project dependency tree.
2. Derive the installed `rcedit` package directory.
3. Use `bin/rcedit-x64.exe` when available, with fallback to `bin/rcedit.exe`.
4. Execute the resolved binary directly for `--set-icon`.

The existing behavior is preserved for:

- PNG-to-ICO conversion
- temp ICO cleanup
- warning-only error handling

## Validation

Validated in a downstream Windows app repo by:

1. running a clean install
2. packaging with `build.win.icon` configured
3. confirming icon embedding succeeds for:
   - `launcher.exe`
   - `bun.exe`
   - the Windows installer EXE

## Notes

The downstream repo currently carries a wrapper-only compatibility workaround until ElectroBun publishes a release containing this fix.
