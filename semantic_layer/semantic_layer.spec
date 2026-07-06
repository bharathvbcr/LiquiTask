# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the LiquiTask semantic layer sidecar (one-file)."""

from pathlib import Path

block_cipher = None
repo_root = Path(SPECPATH).resolve().parent
semantic_layer_dir = repo_root / "semantic_layer"
model_dir = semantic_layer_dir / ".build-cache" / "models" / "all-MiniLM-L6-v2"

datas = []
if model_dir.is_dir():
    datas.append((str(model_dir), "models/all-MiniLM-L6-v2"))

hiddenimports = [
    "semantic_layer",
    "semantic_layer.server",
    "semantic_layer.orchestrator",
    "semantic_layer.embedder",
    "semantic_layer.cache",
    "semantic_layer.compressor",
    "semantic_layer.router",
    "semantic_layer.ood",
    "semantic_layer.backends.ollama",
    "sentence_transformers",
    "transformers",
    "tokenizers",
    "sklearn.utils._typedefs",
    "sklearn.neighbors._partition_nodes",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "httptools",
    "watchfiles",
    "anyio",
    "anyio._backends",
    "anyio._backends._asyncio",
    "faiss",
    "fastapi",
    "pydantic",
    "httpx",
    "numpy",
]

a = Analysis(
    [str(semantic_layer_dir / "entrypoint.py")],
    pathex=[str(repo_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="semantic-layer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
