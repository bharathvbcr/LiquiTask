#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${LIQUITASK_PYTHON:-python3}"

if [[ "${1:-}" == "--all-macos" ]]; then
  exec "$PYTHON" semantic_layer/build_sidecar.py --all-macos "${@:2}"
fi

exec "$PYTHON" semantic_layer/build_sidecar.py "$@"
