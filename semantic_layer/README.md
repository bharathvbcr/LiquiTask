# LiquiTask Semantic Layer Sidecar

Local FastAPI sidecar for Ollama routing, semantic cache, and compression. On desktop (Tauri), the **Rust in-process engine is the default path** — `semanticLayerService.ts` calls Tauri commands (`semantic_layer_spawn`, `semantic_layer_chat`, …) directly. The Python sidecar is used only when `LIQUITASK_USE_PYTHON=1` is set or for standalone dev (`python3 -m semantic_layer`).

LiquiTask spawns the sidecar automatically on desktop launch when **Auto-start sidecar** is enabled in AI settings **and** AI features are enabled (`src/utils/aiFeatures.ts`). Fresh installs that choose Simple Task Management skip sidecar initialization until AI features are turned on.

## Development

Install Python dependencies once:

```bash
python3 -m pip install -r semantic_layer/requirements.txt
export LIQUITASK_SEMANTIC_AUTH_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 -m semantic_layer --port 8765 --auth-token "$LIQUITASK_SEMANTIC_AUTH_TOKEN"
```

Tauri dev mode (`npm run dev`) uses the Rust in-process engine by default. Set `LIQUITASK_USE_PYTHON=1` to force the Python sidecar. Set `LIQUITASK_REPO_ROOT` if spawn cannot find the package.

## Security

- All sidecar HTTP endpoints require `Authorization: Bearer <token>`. The token is generated at spawn time (or set via `LIQUITASK_SEMANTIC_AUTH_TOKEN`).
- The server binds to loopback only by default; non-loopback binds require `--allow-unsafe-bind`.
- `ollama_base_url` is allowlisted to loopback plus hosts explicitly configured via authenticated `/v1/config`. Per-request URL overrides in `/v1/chat` are ignored.
- Cache data under `~/.liquitask/semantic-layer` is stored with `0700` directory / `0600` file permissions.

## Production packaging

Release builds bundle a standalone PyInstaller binary via Tauri `externalBin`.

### Build the sidecar

From the repo root:

```bash
# Current platform (macOS Apple Silicon, Linux, Windows)
npm run build:semantic-sidecar
```

Or use the shell wrapper:

```bash
./scripts/build-semantic-sidecar.sh
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
npm run build:mac      # Apple Silicon macOS DMG
```

### Runtime behavior

| Mode | Engine |
|------|--------|
| Tauri desktop (default) | Rust in-process via Tauri commands |
| `LIQUITASK_USE_PYTHON=1` | Python sidecar (bundled binary or `python3 -m semantic_layer`) |
| Standalone dev | `python3 -m semantic_layer` on `:8765` |

The bundled binary includes MiniLM embedding weights offline (`TRANSFORMERS_OFFLINE=1`).

## Platform notes

| Platform | Target triple | Status |
|----------|---------------|--------|
| macOS Apple Silicon | `aarch64-apple-darwin` | Supported |
| macOS Intel | `x86_64-apple-darwin` | Dropped (deprecated) |
| Linux x64 | `x86_64-unknown-linux-gnu` | Supported |
| Windows x64 | `x86_64-pc-windows-msvc` | Supported (build on Windows host) |

### Size

Expect roughly **250–400 MiB** per sidecar binary (PyTorch + sentence-transformers + MiniLM model).

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
| `LIQUITASK_USE_PYTHON` | Force Python sidecar instead of Rust in-process engine |
| `LIQUITASK_SEMANTIC_AUTH_TOKEN` | Bearer token for sidecar HTTP auth |
| `LIQUITASK_SEMANTIC_CACHE_DIR` | Override cache directory (default `~/.liquitask/semantic-layer`) |
| `VITE_LIQUITASK_SEMANTIC_AUTH_TOKEN` | Web dev: bearer token for HTTP client |
