# LiquiTask

A premium Kanban task management desktop app featuring a stunning liquid glass aesthetic and modern frameless window design.

## Features

- 🎨 **Liquid Glass UI** - Beautiful dark/light mode interface with glassmorphism effects
- 📋 **Kanban Board** - Drag-and-drop task management with customizable columns
- 🏷️ **Custom Fields** - Define your own fields for tasks
- 🔗 **Task Dependencies** - Link tasks with blocking/related relationships
- 🧱 **Native Persistence** - Secure local storage in both Electrobun and Electron
- 📊 **Executive Dashboard** - Cross-project analytics and overview
- ⌨️ **Command Palette** - Quick actions with Cmd+K fuzzy search
- 📤 **Export** - CSV/JSON export with Cmd+E
- 🔔 **Smart Notifications** - Desktop alerts for overdue tasks
- 🎚️ **WIP Limits** - Column limits with visual warnings

## Tech Stack

- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite + Electrobun
- **Desktop:** Electrobun is the default desktop runtime and release target
- **Data:** Native runtime storage bridge, `localStorage` (Web Fallback)
- **Styling:** TailwindCSS

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run in development mode:

   ```bash
   # Desktop app (Electrobun, default)
   npm run dev

   # Web only
   npm run dev:web

   # Desktop app (Electron compatibility path)
   npm run dev:electron

   # Desktop app (Electrobun shell with manual split UI/runtime)
   # Run this in one terminal:
   npm run dev:electrobun:ui
   # Run this in a second terminal:
   npm run dev:electrobun
   ```

## Build for Production

```bash
# Build Electrobun app (default)
npm run build

# Build web bundle only
npm run build:web

# Build Electron app
npm run build:electron

# Build Electrobun app explicitly
npm run build:electrobun

# Package for distribution (Electrobun default)
npm run package

# Package Electron compatibility builds explicitly
npm run package:electron
npm run package:electron:win
npm run package:electron:mac
npm run package:electron:linux
```

## GitHub Releases

Push a semantic version tag to build and publish the Windows Electrobun release automatically:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The release workflow uploads these assets to the GitHub release:

- `stable-win-x64-LiquiTask-Setup.zip`
- `stable-win-x64-LiquiTask.tar.zst`
- `stable-win-x64-update.json`

## Project Structure

```text
LiquiTask/
├── src/
│   ├── components/     # React UI components
│   ├── hooks/          # Custom React hooks
│   ├── services/       # Core services (Storage, Notifications, Export)
│   ├── utils/          # Helper functions
│   └── types.ts        # TypeScript definitions
├── electron/
│   ├── main.ts         # Electron main process
│   └── preload.ts      # ContextBridge & IPC
├── src/bun/
│   └── index.ts        # Electrobun main process entry
├── build/              # Icons and build assets
└── .github/            # CI/CD workflows
```

## Runtime Notes

- Electrobun is the primary desktop runtime and now has a native bridge for window controls, local persistence, and notifications while reusing the same React renderer.
- Electron remains available only as an explicit compatibility path.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open Command Palette |
| `Cmd/Ctrl + E` | Export to CSV |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + Z` | Undo last action |
| `C` | Create new task |
| `Escape` | Close modals |

## QuickAdd Syntax

Create tasks quickly with natural language:

| Syntax | Example | Effect |
|--------|---------|--------|
| `!h/!m/!l` | `Task !high` | Set priority |
| `@today` | `Task @today` | Due today |
| `@tom` | `Task @tom` | Due tomorrow |
| `#project` | `Task #backend` | Assign project |
| `~2h` | `Task ~2h` | Time estimate |
| `+tag` | `Task +urgent` | Add tag |

## License

MIT
