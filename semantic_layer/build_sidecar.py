#!/usr/bin/env python3
"""Build the PyInstaller semantic layer sidecar for Tauri externalBin bundling."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_MODEL_DIR_NAME = "all-MiniLM-L6-v2"


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def semantic_layer_dir() -> Path:
    return Path(__file__).resolve().parent


def detect_target_triple(explicit: str | None) -> str:
    if explicit:
        return explicit

    system = sys.platform
    machine = platform.machine().lower()

    if system == "darwin":
        if machine in {"arm64", "aarch64"}:
            return "aarch64-apple-darwin"
        raise RuntimeError(
            "Intel Macs (x86_64-apple-darwin) are no longer supported; "
            "build on Apple Silicon."
        )
    if system == "win32":
        return "x86_64-pc-windows-msvc"
    if system.startswith("linux"):
        if machine in {"arm64", "aarch64"}:
            return "aarch64-unknown-linux-gnu"
        return "x86_64-unknown-linux-gnu"

    raise RuntimeError(f"Unsupported platform: {system} {machine}")


def sidecar_filename(target_triple: str) -> str:
    if target_triple.endswith("-pc-windows-msvc"):
        return "semantic-layer-x86_64-pc-windows-msvc.exe"
    return f"semantic-layer-{target_triple}"


def run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"+ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def ensure_model(model_cache: Path, python_cmd: list[str]) -> Path:
    model_dir = model_cache / DEFAULT_MODEL_DIR_NAME
    if model_dir.is_dir() and any(model_dir.iterdir()):
        print(f"Using cached embed model at {model_dir}")
        return model_dir

    model_dir.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading embed model {DEFAULT_MODEL} ...")
    run(
        [
            *python_cmd,
            "-c",
            (
                "from sentence_transformers import SentenceTransformer; "
                f"SentenceTransformer('{DEFAULT_MODEL}', device='cpu').save('{model_dir.as_posix()}')"
            ),
        ]
    )
    return model_dir


def ensure_build_venv(venv_dir: Path) -> list[str]:
    python = venv_dir / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.is_file():
        print(f"Creating build venv at {venv_dir}")
        run([sys.executable, "-m", "venv", str(venv_dir)])

    python_cmd = [str(python)]
    run([*python_cmd, "-m", "pip", "install", "--upgrade", "pip"])
    run(
        [
            *python_cmd,
            "-m",
            "pip",
            "install",
            "-r",
            str(semantic_layer_dir() / "build-requirements.txt"),
        ]
    )
    return python_cmd


def build_sidecar(
    *,
    target_triple: str | None,
    skip_model: bool,
    clean: bool,
) -> Path:
    root = repo_root()
    layer_dir = semantic_layer_dir()
    resolved_triple = detect_target_triple(target_triple)
    output_dir = root / "src-tauri" / "binaries"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / sidecar_filename(resolved_triple)

    venv_dir = layer_dir / f".build-venv-{resolved_triple}"
    build_cache = layer_dir / ".build-cache"
    dist_dir = layer_dir / "dist" / resolved_triple
    work_dir = layer_dir / "build" / resolved_triple

    if clean:
        for path in (dist_dir, work_dir):
            if path.exists():
                shutil.rmtree(path)

    build_python_cmd = ensure_build_venv(venv_dir)
    if not skip_model:
        ensure_model(build_cache / "models", build_python_cmd)

    env = os.environ.copy()
    env["PYTHONPATH"] = str(root)

    run(
        [
            *build_python_cmd,
            "-m",
            "PyInstaller",
            str(layer_dir / "semantic_layer.spec"),
            "--noconfirm",
            "--clean",
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(work_dir),
        ],
        cwd=layer_dir,
        env=env,
    )

    built_binary = dist_dir / "semantic-layer"
    if sys.platform == "win32":
        built_binary = dist_dir / "semantic-layer.exe"

    if not built_binary.is_file():
        raise FileNotFoundError(f"PyInstaller output not found: {built_binary}")

    if sys.platform == "darwin":
        actual_arches = subprocess.run(
            ["lipo", "-archs", str(built_binary)], check=True, capture_output=True, text=True
        ).stdout.split()
        if actual_arches != ["arm64"]:
            raise RuntimeError(
                f"Built {built_binary} for {resolved_triple} but lipo reports arches "
                f"{actual_arches}, expected [arm64]."
            )

    shutil.copy2(built_binary, output_path)
    if sys.platform != "win32":
        output_path.chmod(output_path.stat().st_mode | 0o111)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Built sidecar: {output_path} ({size_mb:.1f} MiB)")
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--print-target",
        action="store_true",
        help="Print the detected Rust target triple and exit",
    )
    parser.add_argument(
        "--target",
        help="Rust target triple (e.g. aarch64-apple-darwin, x86_64-pc-windows-msvc)",
    )
    parser.add_argument(
        "--skip-model",
        action="store_true",
        help="Skip model download (requires existing .build-cache/models/all-MiniLM-L6-v2)",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove PyInstaller work/dist directories before building",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.print_target:
        print(detect_target_triple(args.target))
        return

    build_sidecar(
        target_triple=args.target,
        skip_model=args.skip_model,
        clean=args.clean,
    )


if __name__ == "__main__":
    main()
