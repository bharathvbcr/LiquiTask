# GitNexus

This repo is indexed with GitNexus. Agents should use the generated skills in `.claude/skills/generated/` to reference files and understand execution flows before they start broad manual exploration.

## High-Risk Entry Map (first)

Use this first for high-risk change planning:

- `.claude/skills/generated/services/SKILL.md` for persistence, AI service, and storage changes (`indexedDBService.ts`, `storageService.ts`, `aiService.ts`).
- `.claude/skills/generated/hooks/SKILL.md` for orchestration/lifecycle paths (`useAppInitialization.ts`, `useTaskController.ts`, `useTaskAssistant.ts`).
- `.claude/skills/generated/components/SKILL.md` for UI paths touching writes (`TaskFormModal.tsx`, `TaskCard.tsx`, `AutomationRuleEditor.tsx`, `AI*` modals).
- `.claude/skills/generated/settings/SKILL.md` for settings surfaces (`AiSettings`, `DataSettings`) that can trigger data persistence or model calls.

## Secondary Navigation

- `.claude/skills/generated/electron/SKILL.md` for Electron bridge changes.
- `.claude/skills/generated/runtime/SKILL.md` for runtime helpers and test harness behavior.

## Refresh

- Regenerate the map after major structural changes with:

```bash
gitnexus analyze --skills --skip-agents-md
```

## Notes

- The `.gitnexus/` directory is local generated state.
- Prefer GitNexus `context`, `query`, and `impact` when you need dependency or blast-radius information.
