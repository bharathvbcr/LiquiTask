# Third-Party Attribution

## Multica (`vendor/multica-ref/`)

LiquiTask v3 ports patterns and code from [Multica](https://github.com/multica-ai/multica), vendored as a read-only reference snapshot at `vendor/multica-ref/`. This directory is excluded from the LiquiTask build.

**License:** Modified Apache License 2.0 (see `vendor/multica-ref/LICENSE`).

**Usage in LiquiTask:** Personal and internal-organizational use. The rework plan ports:

- `server/pkg/agent` → `liquitask-agentd` Go sidecar (Phase 1)
- `packages/core/*` → `src/core/*` (Phases 2–5)
- `packages/views/*` → `src/views/*` (Phases 2–5)
- `packages/ui/*` → `src/ui/*` (Phase 2+)

**Commercial distribution:** Embedding Multica code in whole or substantial part in a commercially distributed product requires a commercial license from Multica. Revisit before any commercial LiquiTask distribution.

**Source:** `git clone https://github.com/multica-ai/multica.git` (snapshot date: 2026-07-06)
