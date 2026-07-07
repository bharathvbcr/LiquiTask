import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPaths = vi.fn();
const selectDirectory = vi.fn();
const setPaths = vi.fn();

vi.mock("../../../runtime/runtimeEnvironment", () => ({
  isTauri: () => true,
  getDesktopApi: () => ({ workspace: { getPaths, selectDirectory, setPaths } }),
}));

const detectRuntimes = vi.fn();
vi.mock("../../../core/api/localApi", () => ({
  localApi: {
    detectRuntimes: (...a: unknown[]) => detectRuntimes(...a),
  },
}));

const detectIdeTools = vi.fn();
const openInTool = vi.fn();
vi.mock("../../../services/agents/agentRunService", () => ({
  __esModule: true,
  default: {
    detectIdeTools: (...a: unknown[]) => detectIdeTools(...a),
    openInTool: (...a: unknown[]) => openInTool(...a),
  },
}));

import { DevToolsSettings } from "../DevToolsSettings";

const addToast = vi.fn();

beforeEach(() => {
  getPaths.mockResolvedValue(["/home/me/liquitask"]);
  detectRuntimes.mockResolvedValue([
    { id: "claude", name: "Claude Code", version: "1.2.3", ready: true },
    { id: "codex", name: "Codex", ready: false },
  ]);
  detectIdeTools.mockResolvedValue([
    {
      id: "vscode",
      name: "Visual Studio Code",
      binary: "code",
      available: true,
      kind: "ide",
      launch: "path",
    },
    {
      id: "cursor",
      name: "Cursor",
      binary: "cursor",
      available: true,
      kind: "ide",
      launch: "bundle",
      appName: "Cursor",
      path: "/Applications/Cursor.app",
    },
    { id: "zed", name: "Zed", binary: "zed", available: false, kind: "ide", launch: "none" },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DevToolsSettings", () => {
  it("lists detected agentic CLIs and IDEs with installed counts", async () => {
    render(<DevToolsSettings addToast={addToast} />);

    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText("Zed")).toBeInTheDocument();

    expect(screen.getByText("(1/2 installed)", { exact: false })).toBeInTheDocument(); // CLIs
    expect(screen.getByText("(2/3 installed)", { exact: false })).toBeInTheDocument(); // IDEs
  });

  it("launches PATH-detected and bundle-detected IDEs with the right mode", async () => {
    openInTool.mockResolvedValue(undefined);
    render(<DevToolsSettings addToast={addToast} />);

    const ideButtons = await screen.findAllByRole("button", { name: /open in repo/i });
    expect(ideButtons).toHaveLength(2);
    fireEvent.click(ideButtons[0]); // VS Code — PATH launcher
    fireEvent.click(ideButtons[1]); // Cursor — .app bundle

    await waitFor(() => {
      expect(openInTool).toHaveBeenCalledWith("code", "/home/me/liquitask", "app");
      expect(openInTool).toHaveBeenCalledWith("Cursor", "/home/me/liquitask", "bundle");
    });
  });

  it("opens a CLI in a terminal via openInTool (terminal mode)", async () => {
    openInTool.mockResolvedValue(undefined);
    render(<DevToolsSettings addToast={addToast} />);

    const openCliBtn = await screen.findByRole("button", { name: /open in terminal/i });
    fireEvent.click(openCliBtn);

    await waitFor(() =>
      expect(openInTool).toHaveBeenCalledWith("claude", "/home/me/liquitask", "terminal"),
    );
  });

  it("does not render a launch button for tools that are not installed", async () => {
    render(<DevToolsSettings addToast={addToast} />);
    await screen.findByText("Zed");
    // VS Code + Cursor are launchable; Zed (not found) exposes no button.
    expect(screen.getAllByRole("button", { name: /open in repo/i })).toHaveLength(2);
  });
});
