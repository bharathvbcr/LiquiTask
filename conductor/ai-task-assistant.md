# AI Task Assistant - Hybrid Agent (RAG + Tools)

## Background & Motivation
LiquiTask has a solid foundation with AI features like summarization, task generation, and subtask breakdown. Users often need a centralized, conversational way to interact with their entire workspace—asking questions like "What should I work on today?", "Are there any blockers?", or "Create a task for the bug I just mentioned." An omnipresent AI Task Assistant solves this by providing a unified, conversational interface that understands the context of the user's board and can take actions on their behalf. Additionally, users often track notes and tasks in external Markdown files. Integrating the AI assistant with local workspace paths allows it to interact with these files seamlessly.

## Scope & Impact
**Scope:**
- **UI:** A new toggleable **slide-over** Sidebar Drawer (`TaskAssistantSidebar.tsx`) on the right side. It will render as an overlay so it doesn't disturb or reflow the main board and other components.
- **Sidebar Features:** The sidebar will feature:
  - Conversational chat interface with markdown rendering.
  - **Quick Action Chips:** Suggesting common commands (e.g., "Summarize today's tasks", "Find blockers", "Read my daily log").
  - **Context Indicators:** Showing which local workspace paths are currently accessible to the AI.
  - **Chat Management:** Options to clear chat history or start a new thread.
- **State Management:** A new context or hook (`useTaskAssistant.ts`) to manage chat history, loading states, and active tool calls.
- **RAG & Search:** Enhancing `searchIndexService.ts` to provide semantic or high-quality keyword search over tasks to build relevant context for the LLM.
- **Tool Calling:** Expanding `aiService.ts` to support explicit tool definitions (e.g., `createTask`, `updateTask`, `searchTasks`) that the LLM can invoke.
- **Local Workspace Integration:** Adding settings for "Workspace Paths" and Electron IPC handlers in `main.cts` and `preload.cts` to let the AI read, search, and modify `.md` files safely.
- **Providers:** Supporting both Gemini and Ollama.

**Impact:**
- Significant improvement in user productivity by allowing natural language interactions.
- Seamless bridge between LiquiTask and external Markdown files.
- Moderate impact on `aiService.ts` and Electron main process to implement secure IPC tool-calling.

## Proposed Solution
We will implement a **Hybrid Agent (RAG + Tools)**.
1. **Context Retrieval (RAG):** When a user asks a question, the assistant will use `searchIndexService.ts` to find relevant tasks and inject them into the LLM prompt invisibly.
2. **Tool Execution:** The LLM will be provided with a schema of available tools (`create_task`, `update_task_status`, `search_workspace`, `read_workspace_file`, `write_workspace_file`). If the LLM decides to call a tool, the frontend will parse the request, execute the corresponding local or IPC function, and return the result to the LLM.
3. **Local Workspace Tools:** The main process will safely handle file system operations, restricted explicitly to user-configured paths defined in the app's settings.
4. **Conversational UI:** A sleek chat interface in the right slide-over sidebar, featuring message bubbles, typing indicators, quick actions, context visibility, and markdown rendering.

## Phased Implementation Plan
1. **Phase 1: Core Chat UI & State (Slide-over)**
   - Create `TaskAssistantSidebar.tsx` and integrate it as a slide-over overlay on the right side.
   - Add chat interface, quick action chips, and chat management buttons (clear/new thread).
   - Create `useTaskAssistant.ts` to hold the chat history (`Message[]`).
2. **Phase 2: RAG & Context Injection**
   - Implement a lightweight retrieval mechanism to fetch the top N relevant tasks based on the user's message.
3. **Phase 3: Board Tool Calling Orchestration**
   - Define tool schemas for Gemini and Ollama in `aiService.ts`.
   - Implement the execution loop mapping tools to existing functions (e.g., `addTask`, `updateTask`).
4. **Phase 4: Local Workspace Integration**
   - Add "Workspace Folders" to `SettingsModal.tsx`.
   - Add IPC handlers in `main.cts` and `preload.cts` for `search_workspace`, `read_workspace_file`, and `write_workspace_file`.
   - Register these as tools for the LLM.
   - Show active workspace paths in the sidebar as context indicators.
5. **Phase 5: Polish & Feedback**
   - Add clear visual indicators when the AI is "Thinking", "Searching", or "Modifying a file".

## Verification & Testing
- **Unit Tests:** Test the tool-calling orchestration loop in `aiService.ts`.
- **Component Tests:** Verify `TaskAssistantSidebar.tsx` renders correctly as a slide-over and quick actions work.
- **Integration Tests:** Verify Electron IPC limits file operations exclusively to authorized workspace paths.

## Migration & Rollback
- No data migration required.
- If tool calling proves unreliable, we can disable the tool-calling feature via a feature flag in Settings.