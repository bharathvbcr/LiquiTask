import { describe, it, expect } from "vitest";
import path from "path";

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
});
