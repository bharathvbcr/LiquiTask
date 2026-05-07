# LiquiTask

This repo is mapped with GitNexus. Use the generated skills in `.claude/skills/generated/` first when you need to find files, follow flows, or understand module boundaries.

## GitNexus Map

- High-risk first:
  - `.claude/skills/generated/services/SKILL.md`
  - `.claude/skills/generated/hooks/SKILL.md`
  - `.claude/skills/generated/components/SKILL.md`
- Secondary:
  - `.claude/skills/generated/settings/SKILL.md`
  - `.claude/skills/generated/electron/SKILL.md`
  - `.claude/skills/generated/runtime/SKILL.md`
  - `.claude/skills/generated/board/SKILL.md`

## How To Use It

- Start with the generated skill for the area you are editing.
- Prefer GitNexus context and impact queries over broad manual searching when you need callers, callees, or blast radius.
- Refresh the map after structural changes with:

```bash
gitnexus analyze --skills --skip-agents-md
```

## Repo Shape

- `src/` is the main application surface.
- `src/services/` holds persistence, AI, search, and storage logic.
- `src/hooks/` holds orchestration hooks.
- `src/components/` holds the primary UI implementation.
- `components/` contains compatibility wrappers and older UI entry points that still matter.
- `electron/` contains the desktop bridge.
- `src/runtime/` contains runtime helpers and tests.

## Working Rule

If file ownership is unclear, use GitNexus to resolve it before editing.
