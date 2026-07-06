# Semantic layer sidecar binaries (build artifacts)

PyInstaller outputs are written here by `npm run build:semantic-sidecar`:

- `semantic-layer-aarch64-apple-darwin`
- `semantic-layer-x86_64-apple-darwin`
- `semantic-layer-x86_64-pc-windows-msvc.exe`
- `semantic-layer-x86_64-unknown-linux-gnu`

These files are gitignored and must be built before `tauri build`.
