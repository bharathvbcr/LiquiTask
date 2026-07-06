#!/usr/bin/env bash
# Verify the TS -> Rust services migration.
#
# 1. Differential oracle (always runnable, no toolchain needed): proves each
#    Rust port matches the ORIGINAL TypeScript over tens of thousands of fuzzed
#    inputs.
# 2. Rust unit tests for the pure core crate (needs cargo; no system libs).
# 3. Rust build of the Tauri app (needs cargo + platform deps).
# 4. TypeScript unit tests for the migrated services (needs npm deps).
#
# Steps that need a missing tool are skipped with a note, so this is safe to run
# anywhere. Exit code is non-zero if any RUN step fails.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
fail=0
run() { echo; echo "==> $*"; "$@" || { echo "   FAILED: $*"; fail=1; }; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "LiquiTask services -> Rust migration verification"
echo "repo: $ROOT"

# 1) Differential oracle (Node) — the primary correctness gate.
if have node; then
  run node scripts/rust-migration-oracle/run.cjs
else
  echo "   SKIP oracle: node not found"
fi

# 2) Pure core crate unit tests — fast, no system libraries required.
if have cargo; then
  run cargo test --manifest-path crates/liquitask-core/Cargo.toml
else
  echo; echo "==> cargo test -p liquitask-core"; echo "   SKIP: cargo not installed"
fi

# 3) Full Tauri app build (Rust). Heavy; needs platform GUI libs.
if have cargo; then
  run cargo build --manifest-path src-tauri/Cargo.toml
else
  echo; echo "==> cargo build (src-tauri)"; echo "   SKIP: cargo not installed"
fi

# 4) TypeScript service tests.
if have npm && [ -d node_modules ]; then
  run npx vitest run \
    src/services/__tests__/recurringTaskService.test.ts \
    src/services/__tests__/riskAnalysisService.test.ts \
    src/services/__tests__/timeReportingService.test.ts \
    src/services/__tests__/automationService.test.ts \
    src/services/__tests__/automationServiceExtended.test.ts \
    src/services/__tests__/autoOrganizeService.test.ts
else
  echo; echo "==> vitest (migrated services)"; echo "   SKIP: npm/node_modules not ready"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: all runnable checks passed."
else
  echo "RESULT: one or more checks failed (see above)."
fi
exit "$fail"
