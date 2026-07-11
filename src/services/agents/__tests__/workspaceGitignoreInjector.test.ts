import { describe, expect, it, vi } from "vitest";

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: () => true,
  getDesktopApi: () => ({}),
}));

import {
  GITIGNORE_BLOCK_BEGIN,
  GITIGNORE_BLOCK_END,
  WORKSPACE_GITIGNORE_PATTERNS,
  buildWorkspaceGitignoreBlock,
} from "../workspaceGitignoreInjector";

describe("buildWorkspaceGitignoreBlock", () => {
  it("wraps patterns in versioned BEGIN/END markers", () => {
    const block = buildWorkspaceGitignoreBlock();
    expect(block.startsWith(GITIGNORE_BLOCK_BEGIN)).toBe(true);
    expect(block.endsWith(GITIGNORE_BLOCK_END)).toBe(true);
  });

  it("includes DevCouncil and worktree patterns but not blanket *.db", () => {
    const block = buildWorkspaceGitignoreBlock();
    expect(block).toContain(".devcouncil/*");
    expect(block).toContain(".devcouncil/*.db");
    expect(block).toContain(".worktrees/");
    expect(block).not.toMatch(/\n\*\.db\n/);
    expect(block).not.toContain("*.sqlite");
  });

  it("lists every canonical pattern between the markers", () => {
    const lines = buildWorkspaceGitignoreBlock().split("\n");
    const inner = lines.slice(1, -1);
    expect(inner).toEqual([...WORKSPACE_GITIGNORE_PATTERNS]);
  });
});
