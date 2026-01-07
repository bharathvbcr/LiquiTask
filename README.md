<div align="center">
<img width="1200" height="475" alt="LiquiTask Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# LiquiTask

A premium Kanban task management desktop app featuring a stunning liquid glass aesthetic and modern frameless window design.

## Features

- 🎨 **Liquid Glass UI** - Beautiful dark mode interface with glassmorphism effects
- 📋 **Kanban Board** - Drag-and-drop task management with customizable columns
- 🏷️ **Custom Fields** - Define your own fields for tasks
- 🔗 **Task Dependencies** - Link tasks with blocking/related relationships
- 📊 **Executive Dashboard** - Cross-project analytics and overview
- ⌨️ **Keyboard Shortcuts** - Quick actions with Cmd/Ctrl+K, B, C

## Tech Stack

- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite + electron-vite
- **Desktop:** Electron 33
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

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + Z` | Undo last action |
| `C` | Create new task |

## License

MIT
