# LiquiTask

LiquiTask is a premium, desktop-first task management application built with React 19, TypeScript, Vite, and Electron. It features a stunning **Liquid Glass** aesthetic, combining powerful Kanban workflows with advanced AI orchestration.

## What It Includes

- **Stunning Liquid Glass UI**: A premium, high-fidelity interface with advanced glassmorphism, smooth animations, and a cohesive dark-themed aesthetic.
- **Kanban Engine**: Powerful board with drag and drop, WIP limits, and intelligent task cards.
- **Multiple Task Views**: Integrated board, calendar, gantt, archive, and refined dashboard surfaces.
- **AI Task Orchestration**: Intelligent task creation, refinement, and conversational management powered by Gemini and Ollama.
- **Custom Tooltip System**: Custom-built "Liquid Glass" tooltips providing contextual info without breaking visual immersion.
- **Native Desktop Integration**: Custom title bars, system notifications, and local persistence via the Electron bridge.
- **Advanced Task Logic**: Custom fields, subtasks, recurring rules, and bulk actions.
- **Data Sovereignty**: Local-first architecture with CSV/JSON export support.
- **Quality Assured**: Comprehensive test coverage with Vitest and component-level validation.

## AI Integration

LiquiTask 2.4.0 introduces a robust AI layer for intelligent task management, featuring a conversational Task Assistant.

### Supported Providers

- **Google Gemini**: Cloud-based intelligence using the Gemini 3.1 Flash-Lite model.
- **Ollama**: Local, private AI running on your own hardware. Supports any GGUF-compatible model.

### Key AI Capabilities

- **Batch Extraction**: Paste meeting notes or raw text to extract multiple tasks into your active workspace.
- **Task Refinement**: Refine task titles and metadata using natural language or quick-action chips (Summarize, Technical, Formal).
- **One-Click Polish**: Professionalize task descriptions with markdown support.
- **AI Breakdown**: Automatically generate actionable subtask checklists from task summaries.
- **Smart Metadata**: AI-driven suggestions for task priority and tags based on context.
- **AI Workspace Integration**: Allow the AI to securely read, search, and modify `.md` files in user-authorized local directories.
- **AI Task Assistant**: A powerful, conversational glass-panel interface for natural language task management, workspace orchestration, and real-time task extraction. (Toggle with `Cmd/Ctrl + J`).

### Configuration

AI settings are managed in **Settings > AI Settings**. You can configure your preferred provider, enter model card names, and test your connection with real-time feedback. All AI credentials and settings stay strictly local on your device.

## Stack

- React 19
- TypeScript
- Vite
- Electron
- Tailwind CSS
- Vitest

## Requirements

- Node.js 20 or newer
- Bun 1.3 or newer installed locally for Electron desktop development and packaging
- npm
- Windows is the primary packaged target in the current release workflow

## Development

Install dependencies:

```bash
npm install
```

Desktop Electron commands in this repo use the standard Electron CLI for development and packaging.

Run the desktop app with Electron:

```bash
npm run dev
# The dev server now defaults to port 4000
```

Run the web renderer only:

```bash
npm run dev:web
```

## Build

Build the renderer and Electron app:

```bash
npm run build
```

Build only the renderer:

```bash
npm run build:web
```

Create a stable Electron package:

```bash
npm run package
```

Electron outputs are written to:

- `build-electron/`
- `artifacts-electron/`

Those directories are generated build output and should not be committed.

## Test

Run the full test suite:

```bash
npm test -- --run
```

Run coverage:

```bash
npm run test:coverage
```

Lint:

```bash
npm run lint
```

## Release Flow

LiquiTask uses two GitHub Actions release paths:

1. `Release Drafter` updates a draft release on every push to `main`.
2. `Release` runs when a semantic version tag such as `v1.3.0` is pushed.

The tagged release workflow does the following:

1. Installs dependencies with `npm ci`
2. Runs the full test suite
3. Verifies that the git tag matches `package.json`
4. Builds the Electron package
5. Uploads the packaged Windows artifacts to the GitHub Release

Current release assets:

- `LiquiTask Setup 2.4.0.exe`
- `LiquiTask Setup 2.4.0.exe.blockmap`

Create a release:

```bash
git tag v2.4.0
git push origin v2.4.0
```

Before tagging a new version, update:

- `package.json`
- `package-lock.json`

## Patch Notes

Patch notes are generated automatically with Release Drafter.

Files involved:

- `.github/workflows/release-drafter.yml`
- `.github/release-drafter.yml`
- `.github/workflows/release.yml`

Release Drafter behavior in this repo:

- groups changes into Features, Fixes, Security, Documentation, and Maintenance
- auto-labels some changes based on touched files
- defaults unlabeled releases to a patch bump
- keeps a draft release updated on `main`

The final tagged release is still created by the `Release` workflow, which publishes the packaged assets.

## Project Structure

```text
LiquiTask/
├── components/              Shared UI layer used by the desktop app
├── src/
│   ├── bun/                 Electron desktop entrypoint
│   ├── components/          Main React UI
│   ├── constants/           Shared constants and keybindings
│   ├── context/             React context providers
│   ├── contexts/            Additional app contexts
│   ├── hooks/               App controllers and UI hooks
│   ├── migrations/          Data migration logic
│   ├── runtime/             Runtime detection and Electron bridge
│   ├── services/            Persistence, export, notifications, automation
│   ├── test/                Test setup
│   ├── types/               Shared types
│   └── utils/               Parsers, query helpers, validation, search helpers
├── build/                   Icons and packaging assets
└── .github/                 CI, release, and code scanning workflows
```

## Keyboard Shortcuts

- `Cmd/Ctrl + K` opens the command palette
- `Cmd/Ctrl + J` toggles the AI Task Assistant
- `Cmd/Ctrl + E` exports data
- `Cmd/Ctrl + B` toggles the sidebar
- `Cmd/Ctrl + Z` undoes the last action
- `C` creates a task
- `Escape` closes active overlays

## License

MIT
