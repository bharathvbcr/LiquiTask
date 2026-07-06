#!/usr/bin/env bash
# Creates minimal native stub sidecars so Tauri dev/cargo check succeed before
# the full PyInstaller build runs. Release builds overwrite these files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

create_stub() {
  local triple="$1"
  local output="$BIN_DIR/semantic-layer-${triple}"
  if [[ "$triple" == *"-pc-windows-msvc" ]]; then
    output="${output}.exe"
  fi

  if [[ -f "$output" ]]; then
    local size
    size="$(wc -c < "$output" | tr -d ' ')"
    # Skip if a real PyInstaller build is already present (>1 MiB).
    if (( size > 1048576 )); then
      echo "Keeping existing sidecar at $output"
      return 0
    fi
  fi

  if command -v rustc >/dev/null 2>&1; then
    rustc -O "$ROOT/scripts/semantic-sidecar-stub.rs" -o "$output"
  else
    cat <<'EOF' | cc -x c - -o "$output"
#include <stdio.h>
int main(void) {
  fprintf(
    stderr,
    "Semantic layer sidecar stub. Run: npm run build:semantic-sidecar\n"
  );
  return 1;
}
EOF
  fi

  if [[ "$output" != *.exe ]]; then
    chmod +x "$output"
  fi

  echo "Created sidecar stub: $output"
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  create_stub "aarch64-apple-darwin"
  create_stub "x86_64-apple-darwin"
else
  triple="$(python3 semantic_layer/build_sidecar.py --print-target)"
  create_stub "$triple"
fi
