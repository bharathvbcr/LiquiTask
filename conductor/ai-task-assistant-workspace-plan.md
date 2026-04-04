# AI Task Assistant Workspace Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement local workspace path management and IPC handlers so the AI Assistant can search, read, and write `.md` files in user-configured directories.

**Architecture:** Electron's main process will handle file system operations via `fs/promises`. We will store workspace paths in `electron-store` (using existing `writeStorage` mechanism) and expose `ipcMain.handle` functions to `preload.cts`. The `AiSettings.tsx` component will be updated to manage these paths.

**Tech Stack:** React, Electron, TypeScript, Node.js `fs`.

---

### Task 1: Add IPC Handlers for Workspace Paths in Main Process

**Files:**
- Modify: `electron/main.cts:30-60`
- Test: `electron/__tests__/main.test.cts` (Assuming it exists, if not, skip test step for electron main as it's typically tested via e2e or mocked)

- [ ] **Step 1: Write the failing test**

```typescript
// Skip for electron main process if testing setup isn't available for IPC yet.
// We will test via the preload script integration instead.
```

- [ ] **Step 2: Run test to verify it fails**

(Skipped - manual verification later)

- [ ] **Step 3: Write minimal implementation**

```typescript
// Add these IPC handlers in electron/main.cts before createWindow()
import { glob } from 'fs/promises'; // for search if available, or write a simple recursive readdir

ipcMain.handle('getWorkspacePaths', async () => {
  const store = await readStorage();
  return (store.workspacePaths as string[]) || [];
});

ipcMain.handle('setWorkspacePaths', async (_, paths: string[]) => {
  const store = await readStorage();
  store.workspacePaths = paths;
  await writeStorage(store);
});

ipcMain.handle('readWorkspaceFile', async (_, filePath: string) => {
  const store = await readStorage();
  const paths = (store.workspacePaths as string[]) || [];
  // Security check: ensure filePath is within one of the authorized paths
  const isAuthorized = paths.some(p => filePath.startsWith(p));
  if (!isAuthorized) throw new Error('Unauthorized path');
  return fs.readFile(filePath, 'utf-8');
});

ipcMain.handle('writeWorkspaceFile', async (_, filePath: string, content: string) => {
  const store = await readStorage();
  const paths = (store.workspacePaths as string[]) || [];
  const isAuthorized = paths.some(p => filePath.startsWith(p));
  if (!isAuthorized) throw new Error('Unauthorized path');
  await fs.writeFile(filePath, content, 'utf-8');
});
```

- [ ] **Step 4: Run test to verify it passes**

(Skipped - manual verification later)

- [ ] **Step 5: Commit**

```bash
git add electron/main.cts
git commit -m "feat: add workspace IPC handlers"
```

### Task 2: Expose IPC Handlers in Preload Script

**Files:**
- Modify: `electron/preload.cts`

- [ ] **Step 1: Write the failing test**

```typescript
// No direct test for preload, testing will be done in the frontend component
```

- [ ] **Step 2: Run test to verify it fails**

(Skipped)

- [ ] **Step 3: Write minimal implementation**

```typescript
// In electron/preload.cts, inside contextBridge.exposeInMainWorld('electronAPI', { ... })
// Add the following under the existing methods:

  workspace: {
    getPaths: () => ipcRenderer.invoke('getWorkspacePaths'),
    setPaths: (paths: string[]) => ipcRenderer.invoke('setWorkspacePaths', paths),
    readFile: (filePath: string) => ipcRenderer.invoke('readWorkspaceFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('writeWorkspaceFile', filePath, content),
  },
```

- [ ] **Step 4: Run test to verify it passes**

(Skipped)

- [ ] **Step 5: Commit**

```bash
git add electron/preload.cts
git commit -m "feat: expose workspace API in preload"
```

### Task 3: Update AI Settings UI to Manage Workspace Paths

**Files:**
- Modify: `components/settings/AiSettings.tsx`
- Test: `components/settings/__tests__/AiSettings.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// In components/settings/__tests__/AiSettings.test.tsx (create if doesn't exist)
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiSettings } from '../AiSettings';

// Mock electronAPI
(global as any).window.electronAPI = {
  workspace: {
    getPaths: vi.fn().mockResolvedValue(['/test/path']),
    setPaths: vi.fn().mockResolvedValue(undefined),
  }
};

test('loads and displays workspace paths', async () => {
  render(<AiSettings addToast={vi.fn()} />);
  await waitFor(() => {
    expect(screen.getByDisplayValue('/test/path')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/settings/__tests__/AiSettings.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```tsx
// In components/settings/AiSettings.tsx, add state and load effect
// Inside AiSettings component:
const [workspacePaths, setWorkspacePaths] = useState<string[]>([]);
const [newPath, setNewPath] = useState("");

useEffect(() => {
  if (window.electronAPI?.workspace) {
    window.electronAPI.workspace.getPaths().then(setWorkspacePaths);
  }
}, []);

const handleAddPath = async () => {
  if (!newPath) return;
  const updated = [...workspacePaths, newPath];
  setWorkspacePaths(updated);
  if (window.electronAPI?.workspace) {
    await window.electronAPI.workspace.setPaths(updated);
  }
  setNewPath("");
};

const handleRemovePath = async (pathToRemove: string) => {
  const updated = workspacePaths.filter(p => p !== pathToRemove);
  setWorkspacePaths(updated);
  if (window.electronAPI?.workspace) {
    await window.electronAPI.workspace.setPaths(updated);
  }
};

// Add to JSX return under the Gemini settings:
<div className="mt-8 border-t pt-6">
  <h3 className="text-lg font-medium flex items-center gap-2 mb-4">
    <Globe className="w-5 h-5" /> Workspace Integration
  </h3>
  <p className="text-sm text-gray-500 mb-4">
    Allow the AI to read and write .md files in these directories.
  </p>
  <div className="flex gap-2 mb-4">
    <input 
      type="text" 
      value={newPath} 
      onChange={(e) => setNewPath(e.target.value)} 
      placeholder="e.g. C:\Projects\Notes"
      className="flex-1 p-2 border rounded"
    />
    <button onClick={handleAddPath} className="px-4 py-2 bg-blue-600 text-white rounded">Add Path</button>
  </div>
  <ul className="space-y-2">
    {workspacePaths.map(p => (
      <li key={p} className="flex justify-between items-center bg-gray-50 p-2 rounded">
        <span>{p}</span>
        <button onClick={() => handleRemovePath(p)} className="text-red-500 hover:text-red-700">
          <Trash2 className="w-4 h-4" />
        </button>
      </li>
    ))}
  </ul>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/settings/__tests__/AiSettings.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/settings/AiSettings.tsx components/settings/__tests__/AiSettings.test.tsx
git commit -m "feat: UI to manage workspace paths in settings"
```
