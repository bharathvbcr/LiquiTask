# ElectroBun issue draft

## Title

Windows packaging resolves `rcedit` from a baked CI path in `electrobun@1.15.1`

## Summary

`electrobun@1.15.1` packages successfully on Windows, but icon embedding tries to execute `rcedit` from a baked CI path like:

`D:\a\electrobun\electrobun\package\node_modules\rcedit\bin\rcedit-x64.exe`

That path does not exist in normal local installs, so Windows packaging falls back to warnings and drops the configured app icon.

## Reproduction

Environment:

- Windows
- `electrobun@1.15.1`
- local app project using `build.win.icon`

Steps:

1. Install dependencies in a normal app project that depends on ElectroBun.
2. Configure `build.win.icon` in `electrobun.config.ts`.
3. Run `electrobun build --env=stable`.

## Actual behavior

ElectroBun logs warnings similar to:

```text
Warning: Failed to embed icon into launcher.exe: Error executing command (D:\a\electrobun\electrobun\package\node_modules\rcedit\bin\rcedit-x64.exe ...)
spawn D:\a\electrobun\electrobun\package\node_modules\rcedit\bin\rcedit-x64.exe ENOENT
```

The package may still build, but the icon embedding step does not use the configured icon.

## Expected behavior

ElectroBun should resolve `rcedit` from the locally installed dependency tree and embed the configured icon successfully on Windows.

## Root cause

The Windows icon embedding path uses `rcedit` in a way that ends up tied to a baked build-time/snapshot path instead of the local package installation path.

## Proposed fix

In `src/cli/index.ts`, replace the current `await import("rcedit")` usage in the Windows icon embedding paths with explicit local resolution:

1. Resolve `rcedit/package.json` from the project dependency tree.
2. Derive the installed `rcedit` package directory from that path.
3. Prefer `bin/rcedit-x64.exe`, then fallback to `bin/rcedit.exe`.
4. Execute that resolved binary directly for `--set-icon`.
5. Keep the existing PNG-to-ICO conversion and warning-only failure handling.

## Attached repo artifacts

- Source diff: `docs/electrobun-rcedit-upstream.diff`
- Notes: `docs/electrobun-rcedit-upstream.md`
