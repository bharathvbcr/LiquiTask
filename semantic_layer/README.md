# Semantic Layer Sidecar

Local FastAPI sidecar for Ollama routing, semantic cache, and compression. LiquiTask spawns it automatically on desktop launch when **Auto-start sidecar** is enabled in AI settings.

## Development

Install Python dependencies once:

```bash
python3 -m pip install -r semantic_layer/requirements.txt
python3 -m semantic_layer --port 8765
```

Tauri dev mode (`npm run dev`) uses `python3 -m semantic_layer` from the repo root. Set `LIQUITASK_REPO_ROOT` if spawn cannot find the package.

## Production packaging

Release builds bundle a standalone PyInstaller binary via Tauri `externalBin`.

### Build the sidecar

From the repo root:

```bash
# Current platform (macOS arm64/x64, Linux, Windows)
npm run build:semantic-sidecar

# Universal macOS app (both arm64 + x86_64 sidecars)
npm run build:semantic-sidecar:macos
```

Or use the shell wrapper:

```bash
./scripts/build-semantic-sidecar.sh
./scripts/build-semantic-sidecar.sh --all-macos
```

Output lands in `src-tauri/binaries/` as `semantic-layer-{target-triple}` (`.exe` on Windows).

For local Tauri dev / `cargo check`, create compile-time stub binaries:

```bash
npm run prepare:semantic-sidecar-stub
```

(`npm run dev` runs this automatically.)

The build script:

1. Creates `semantic_layer/.build-venv` and installs `build-requirements.txt`
2. Downloads `sentence-transformers/all-MiniLM-L6-v2` (~90 MiB) into `.build-cache/models/`
3. Runs PyInstaller (`semantic_layer.spec`) as a one-file executable
4. Copies the binary into `src-tauri/binaries/` for Tauri bundling

### Build the desktop app

Sidecar build is hooked into release commands:

```bash
npm run build          # current platform
npm run build:mac      # universal macOS DMG
```

### Runtime behavior

| Mode | Spawn command |
|------|----------------|
| `tauri dev` (debug) | `python3 -m semantic_layer` |
| Release / packaged | Bundled `semantic-layer` next to the app executable |
| Override | Set `LIQUITASK_USE_PYTHON=1` to force Python in release builds |

The bundled binary includes MiniLM embedding weights offline (`TRANSFORMERS_OFFLINE=1`).

## Platform notes

| Platform | Target triple | Status |
|----------|---------------|--------|
| macOS Apple Silicon | `aarch64-apple-darwin` | Supported |
| macOS Intel | `x86_64-apple-darwin` | Supported (`--all-macos`) |
| Linux x64 | `x86_64-unknown-linux-gnu` | Supported |
| Windows x64 | `x86_64-pc-windows-msvc` | Supported (build on Windows host) |

### Size

Expect roughly **250–400 MiB** per sidecar binary (PyTorch + sentence-transformers + MiniLM model). Universal macOS builds ship two sidecars.

### Limitations

- **Code signing**: macOS/Windows sidecars inherit the app's signing flow; ad-hoc builds work locally but distribution may require notarization.
- **Windows SmartScreen**: Unsigned Windows builds may warn until Authenticode signing is configured.
- **First build time**: PyInstaller + model download can take several minutes.
- **Cross-compilation**: Build the sidecar on each target OS/arch (no Linux→Windows cross-build).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `LIQUITASK_REPO_ROOT` | Repo root for dev Python spawn |
| `LIQUITASK_PYTHON` | Python executable for dev spawn |
| `LIQUITASK_USE_PYTHON` | Force Python spawn in release builds |
