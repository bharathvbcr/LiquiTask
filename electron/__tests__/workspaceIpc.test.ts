import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mirrors the isPathAuthorized function from electron/main.cts.
 * Tests the security boundary that restricts file operations to
 * user-configured workspace paths only.
 */
const isPathAuthorized = (filePath: string, authorizedPaths: string[]): boolean => {
  const normalizedPath = path.normalize(filePath);
  const isCaseInsensitive = process.platform === "win32";

  return authorizedPaths.some((p) => {
    const authorized = path.normalize(p);
    const a = isCaseInsensitive ? authorized.toLowerCase() : authorized;
    const b = isCaseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
    return b === a || b.startsWith(a + path.sep);
  });
};

const resolveWorkspaceScope = (authorizedPaths: string[], requestedScopePaths?: string[]) => {
  if (requestedScopePaths === undefined) {
    return authorizedPaths;
  }

  if (requestedScopePaths.length === 0) {
    return [];
  }

  return requestedScopePaths.filter((scopePath) => isPathAuthorized(scopePath, authorizedPaths));
};

const SUPPORTED_WORKSPACE_FILE_EXTENSIONS = new Set([".json", ".md", ".py", ".ts", ".tsx"]);
const SUPPORTED_WORKSPACE_FILE_NAMES = new Set([".gitignore", "dockerfile", "makefile"]);
const SKIPPED_WORKSPACE_DIR_NAMES = new Set([".git", "build", "dist", "node_modules", "release"]);

const isWorkspaceTextFile = (filePath: string): boolean => {
  const fileName = path.basename(filePath).toLowerCase();
  if (SUPPORTED_WORKSPACE_FILE_NAMES.has(fileName)) return true;
  return SUPPORTED_WORKSPACE_FILE_EXTENSIONS.has(path.extname(fileName));
};

const isSkippedWorkspaceDirectory = (dirName: string): boolean =>
  SKIPPED_WORKSPACE_DIR_NAMES.has(dirName.toLowerCase());

const isPathAuthorizedForScope = (
  filePath: string,
  authorizedPaths: string[],
  requestedScopePaths?: string[],
): boolean => {
  return isPathAuthorized(filePath, resolveWorkspaceScope(authorizedPaths, requestedScopePaths));
};

describe("Workspace IPC Path Authorization", () => {
  const unix = {
    authorized: ["/home/user/notes", "/home/user/projects"],
    inside: "/home/user/notes/daily.md",
    nested: "/home/user/projects/app/src/README.md",
    outside: "/home/user/private/secret.md",
    parentDir: "/home/user",
    prefixAttack: "/home/user/notes-evil/file.md",
    traversal: "/home/user/notes/../../etc/passwd",
    exact: "/home/user/notes",
  };

  it("allows files directly inside an authorized directory", () => {
    expect(isPathAuthorized(unix.inside, unix.authorized)).toBe(true);
  });

  it("allows files in nested subdirectories of authorized paths", () => {
    expect(isPathAuthorized(unix.nested, unix.authorized)).toBe(true);
  });

  it("blocks files outside all authorized directories", () => {
    expect(isPathAuthorized(unix.outside, unix.authorized)).toBe(false);
  });

  it("blocks access to a parent directory of an authorized path", () => {
    expect(isPathAuthorized(unix.parentDir, unix.authorized)).toBe(false);
  });

  it("blocks path prefix attacks (notes-evil should not match notes/)", () => {
    expect(isPathAuthorized(unix.prefixAttack, unix.authorized)).toBe(false);
  });

  it("blocks path traversal attacks that escape the workspace", () => {
    // path.normalize resolves ../../ so /home/user/notes/../../etc/passwd → /etc/passwd
    expect(isPathAuthorized(unix.traversal, unix.authorized)).toBe(false);
  });

  it("allows exact match of the authorized path itself", () => {
    expect(isPathAuthorized(unix.exact, unix.authorized)).toBe(true);
  });

  it("returns false when no workspace paths are configured", () => {
    expect(isPathAuthorized(unix.inside, [])).toBe(false);
  });

  it("handles multiple authorized paths correctly", () => {
    const paths = ["/workspace/a", "/workspace/b"];
    expect(isPathAuthorized("/workspace/a/file.md", paths)).toBe(true);
    expect(isPathAuthorized("/workspace/b/sub/file.md", paths)).toBe(true);
    expect(isPathAuthorized("/workspace/c/file.md", paths)).toBe(false);
  });

  it("allows access when the requested project scope stays within the global allowlist", () => {
    expect(
      isPathAuthorizedForScope(
        "/workspace/a/notes/today.md",
        ["/workspace/a", "/workspace/b"],
        ["/workspace/a/notes"],
      ),
    ).toBe(true);
  });

  it("blocks access to globally authorized folders that are outside the requested project scope", () => {
    expect(
      isPathAuthorizedForScope(
        "/workspace/b/notes/today.md",
        ["/workspace/a", "/workspace/b"],
        ["/workspace/a/notes"],
      ),
    ).toBe(false);
  });

  it("blocks access when the requested scope is not itself inside the global allowlist", () => {
    expect(
      isPathAuthorizedForScope(
        "/workspace/private/secret.md",
        ["/workspace/a", "/workspace/b"],
        ["/workspace/private"],
      ),
    ).toBe(false);
  });

  it("allows common source and project text files in workspace tools", () => {
    expect(isWorkspaceTextFile("/workspace/app/src/App.tsx")).toBe(true);
    expect(isWorkspaceTextFile("/workspace/app/scripts/migrate.py")).toBe(true);
    expect(isWorkspaceTextFile("/workspace/app/package.json")).toBe(true);
    expect(isWorkspaceTextFile("/workspace/app/.gitignore")).toBe(true);
    expect(isWorkspaceTextFile("/workspace/app/Dockerfile")).toBe(true);
  });

  it("blocks binary and secret-like files from workspace tools", () => {
    expect(isWorkspaceTextFile("/workspace/app/.env")).toBe(false);
    expect(isWorkspaceTextFile("/workspace/app/cert.pem")).toBe(false);
    expect(isWorkspaceTextFile("/workspace/app/screenshot.png")).toBe(false);
    expect(isWorkspaceTextFile("/workspace/app/archive.zip")).toBe(false);
  });

  it("skips generated and dependency directories during workspace search", () => {
    expect(isSkippedWorkspaceDirectory("node_modules")).toBe(true);
    expect(isSkippedWorkspaceDirectory(".git")).toBe(true);
    expect(isSkippedWorkspaceDirectory("dist")).toBe(true);
    expect(isSkippedWorkspaceDirectory("src")).toBe(false);
  });
});
