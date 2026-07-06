# Sidecar binaries (build artifacts)

PyInstaller outputs are written here by `npm run build:semantic-sidecar`:

- `semantic-layer-aarch64-apple-darwin`
- `semantic-layer-x86_64-pc-windows-msvc.exe`
- `semantic-layer-x86_64-unknown-linux-gnu`

The Go agentd sidecar is written here by `npm run build:agentd`
(`scripts/build-agentd-sidecar.sh`), which builds
`liquitask-agentd/cmd/liquitask-agentd` and places it with the matching
Rust target-triple suffix:

- `liquitask-agentd-aarch64-apple-darwin`
- `liquitask-agentd-x86_64-pc-windows-msvc.exe`
- `liquitask-agentd-x86_64-unknown-linux-gnu`

These files are gitignored and must be built before `tauri build`.
