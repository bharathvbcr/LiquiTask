"""Runtime paths for PyInstaller-frozen semantic layer sidecar."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def bundle_root() -> Path | None:
    if not is_frozen():
        return None
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(sys.executable).resolve().parent


def bundled_embed_model_path() -> Path | None:
    root = bundle_root()
    if root is None:
        return None
    model_dir = root / "models" / "all-MiniLM-L6-v2"
    return model_dir if model_dir.is_dir() else None


def configure_frozen_environment() -> None:
    """Point Hugging Face / sentence-transformers caches at bundled model files."""
    if not is_frozen():
        return

    root = bundle_root()
    if root is None:
        return

    models_home = root / "models"
    models_home.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(models_home))
    os.environ.setdefault("HF_HOME", str(models_home))
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
