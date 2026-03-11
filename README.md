# LiquiTask

LiquiTask is a desktop-first task management app built with React, TypeScript, Vite, and Electrobun. It combines a Kanban workflow with saved views, automation, recurring tasks, time tracking, export tools, and a glass-heavy desktop UI.

## What It Includes

- Kanban board with drag and drop, WIP limits, and keyboard navigation
- Multiple task views including board, calendar, gantt, archive, and dashboard surfaces
- Custom fields, subtasks, task links, tags, templates, and quick-add parsing
- Native desktop window controls, notifications, and local persistence through the Electrobun runtime bridge
- Search history, saved views, bulk actions, automation rules, recurring tasks, and time reporting
- CSV and JSON export support
- Unit and component test coverage with Vitest and Testing Library

## Stack

- React 19
- TypeScript
- Vite
- Electrobun
- Tailwind CSS
- Vitest

## Requirements

- Node.js 20 or newer
- Bun 1.3 or newer installed locally for Electrobun desktop development and packaging
- npm
- Windows is the primary packaged target in the current release workflow

## Development

Install dependencies:

```bash
npm install
```

Desktop Electrobun commands in this repo run through the checked-in wrapper at `scripts/electrobun.cjs`, which materializes a local patched ElectroBun CLI source tree for Windows icon embedding and uses the `.electrobun-shims/powershell.cmd` shim for archive commands. `electrobun init` is delegated to the stock ElectroBun launcher.

Run the desktop app with Electrobun:

```bash
npm run dev
```

Run the web renderer only:

```bash
npm run dev:web
```

## Build

Build the renderer and Electrobun app:

```bash
npm run build
```

Build only the renderer:

```bash
npm run build:web
```

Create a stable Electrobun package:

```bash
npm run package
```

Electrobun outputs are written to:

- `build-electrobun/`
- `artifacts-electrobun/`

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
2. `Release` runs when a semantic version tag such as `v1.0.2` is pushed.

The tagged release workflow does the following:

1. Installs dependencies with `npm ci`
2. Runs the full test suite
3. Verifies that the git tag matches `package.json` and `electrobun.config.ts`
4. Builds the Electrobun package
5. Uploads the packaged Windows artifacts to the GitHub Release

Current release assets:

- `stable-win-x64-LiquiTask-Setup.zip`
- `stable-win-x64-LiquiTask.tar.zst`
- `stable-win-x64-update.json`

Create a release:

```bash
git tag v1.0.2
git push origin v1.0.2
```

Before tagging a new version, update:

- `package.json`
- `package-lock.json`
- `electrobun.config.ts`

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
│   ├── bun/                 Electrobun desktop entrypoint
│   ├── components/          Main React UI
│   ├── constants/           Shared constants and keybindings
│   ├── context/             React context providers
│   ├── contexts/            Additional app contexts
│   ├── hooks/               App controllers and UI hooks
│   ├── migrations/          Data migration logic
│   ├── runtime/             Runtime detection and Electrobun bridge
│   ├── services/            Persistence, export, notifications, automation
│   ├── test/                Test setup
│   ├── types/               Shared types
│   └── utils/               Parsers, query helpers, validation, search helpers
├── build/                   Icons and packaging assets
└── .github/                 CI, release, and code scanning workflows
```

## Keyboard Shortcuts

- `Cmd/Ctrl + K` opens the command palette
- `Cmd/Ctrl + E` exports data
- `Cmd/Ctrl + B` toggles the sidebar
- `Cmd/Ctrl + Z` undoes the last action
- `C` creates a task
- `Escape` closes active overlays

## License

MIT
