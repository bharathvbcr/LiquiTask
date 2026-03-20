# Objective
Enhance the AI Settings UI to fetch and display a list of downloaded Ollama models from the local server, allowing users to select them from a dropdown instead of typing the names manually.

# Key Files & Context
- `src/services/aiService.ts`: Contains the `AIProvider` interface and `OllamaProvider` implementation.
- `components/settings/AiSettings.tsx`: The UI component for AI configuration.

# Implementation Steps
1. **Extend AIProvider Interface**: Add an optional `listModels?(): Promise<string[]>` method to the `AIProvider` interface in `src/services/aiService.ts`.
2. **Implement `listModels` in OllamaProvider**: Add the method to `OllamaProvider`. It should fetch from `${baseUrl}/api/tags`, parse the `models` array, and return a list of model names (`m.name`).
3. **Expose `listModels` in AiService**: Add an async `listModels()` method to the `AiService` class that delegates to the active provider (if it supports it).
4. **Update `AiSettings` Component**:
    - Add state variables: `availableModels` (string array), `isLoadingModels` (boolean), and `modelFetchError` (string).
    - Add a `fetchModels` function that attempts to load models via `aiService.listModels()` whenever the Ollama base URL changes or the user switches to the Ollama provider.
    - Modify the "Model Name" input in the Ollama settings section. If models are successfully fetched, render a `<select>` dropdown instead of a text `<input>`. Provide an option to manually enter a model name if the fetch fails or the user prefers it.
    - Include a refresh button next to the dropdown to re-fetch models.

# Verification & Testing
- Start a local Ollama instance with some models pulled.
- Open the LiquiTask AI settings, select Ollama.
- Verify the dropdown populates with the downloaded models.
- Verify that changing the Base URL dynamically attempts to fetch models from the new URL.
- Verify that the standard configuration save and test connection flows still work correctly with the selected model.