#!/usr/bin/env bash
# Builds the Go liquitask-agentd binary and places it in src-tauri/binaries/
# with the Rust target-triple suffix Tauri's `externalBin` convention expects
# (mirrors scripts/build-semantic-sidecar.sh + create-semantic-sidecar-stub.sh
# for the semantic-layer sidecar).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

# Detect the Rust host target triple. Allow an explicit override (e.g. cross
# builds / CI matrix jobs) via AGENTD_TARGET_TRIPLE, otherwise ask rustc.
if [[ -n "${AGENTD_TARGET_TRIPLE:-}" ]]; then
  TRIPLE="$AGENTD_TARGET_TRIPLE"
elif command -v rustc >/dev/null 2>&1; then
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
else
  echo "error: rustc not found and AGENTD_TARGET_TRIPLE not set; cannot determine target triple" >&2
  exit 1
fi

if [[ -z "$TRIPLE" ]]; then
  echo "error: could not determine target triple" >&2
  exit 1
fi

OUTPUT_NAME="liquitask-agentd-${TRIPLE}"
if [[ "$TRIPLE" == *"-pc-windows-msvc" ]]; then
  OUTPUT_NAME="${OUTPUT_NAME}.exe"
fi
OUTPUT="$BIN_DIR/$OUTPUT_NAME"

echo "+ building liquitask-agentd for $TRIPLE"
(
  cd "$ROOT/liquitask-agentd"
  GOOS="${AGENTD_GOOS:-}"
  GOARCH="${AGENTD_GOARCH:-}"
  if [[ -n "$GOOS" || -n "$GOARCH" ]]; then
    env ${GOOS:+GOOS="$GOOS"} ${GOARCH:+GOARCH="$GOARCH"} go build -o "$OUTPUT" ./cmd/liquitask-agentd
  else
    go build -o "$OUTPUT" ./cmd/liquitask-agentd
  fi
)

if [[ "$OUTPUT" != *.exe ]]; then
  chmod +x "$OUTPUT"
fi

echo "Built agentd sidecar: $OUTPUT"
