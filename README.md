# LiquiTask

A premium Kanban task management desktop app featuring a stunning liquid glass aesthetic and modern frameless window design.

## Features

- 🎨 **Liquid Glass UI** - Beautiful dark/light mode interface with glassmorphism effects
- 📋 **Kanban Board** - Drag-and-drop task management with customizable columns
- 🏷️ **Custom Fields** - Define your own fields for tasks
- 🔗 **Task Dependencies** - Link tasks with blocking/related relationships
- 🧱 **Native Persistence** - Secure local file system storage with `electron-store`
- 📊 **Executive Dashboard** - Cross-project analytics and overview
- ⌨️ **Command Palette** - Quick actions with Cmd+K fuzzy search
- 📤 **Export** - CSV/JSON export with Cmd+E
- 🔔 **Smart Notifications** - Desktop alerts for overdue tasks
- 🎚️ **WIP Limits** - Column limits with visual warnings

## Tech Stack

- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite + electron-vite
- **Desktop:** Electron 33 (`electron-react-boilerplate` architecture)
- **Data:** `electron-store` (Native), `localStorage` (Web Fallback)
- **Styling:** TailwindCSS

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run in development mode:

   ```bash
   # Web only
   npm run dev

   # Desktop app (Electron)
   npm run dev:electron
   ```

## Build for Production

```bash
# Build web version
npm run build

# Build Electron app
npm run build:electron

# Package for distribution
npm run package          # Current platform
npm run package:win      # Windows
npm run package:mac      # macOS
npm run package:linux    # Linux
```

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
├── build/              # Icons and build assets
└── .github/            # CI/CD workflows
```

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
