#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${LIQUITASK_PYTHON:-python3}"

exec "$PYTHON" semantic_layer/build_sidecar.py "$@"
