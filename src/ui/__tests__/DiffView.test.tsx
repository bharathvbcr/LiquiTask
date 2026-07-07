import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DIFF_LINE_CAP, DiffView, parseUnifiedDiff } from "../DiffView";

const MULTI_FILE_DIFF = [
  "diff --git a/src/alpha.ts b/src/alpha.ts",
  "index 1111111..2222222 100644",
  "--- a/src/alpha.ts",
  "+++ b/src/alpha.ts",
  "@@ -1,3 +1,4 @@",
  " const x = 1;",
  "-const y = 2;",
  "+const y = 3;",
  "+const z = 4;",
  "diff --git a/src/beta.ts b/src/beta.ts",
  "index 3333333..4444444 100644",
  "--- a/src/beta.ts",
  "+++ b/src/beta.ts",
  "@@ -10,2 +10,1 @@",
  "-old line",
  " context line",
].join("\n");

const RENAME_DIFF = [
  "diff --git a/src/old-name.ts b/src/new-name.ts",
  "similarity index 100%",
  "rename from src/old-name.ts",
  "rename to src/new-name.ts",
].join("\n");

const BINARY_DIFF = [
  "diff --git a/assets/logo.png b/assets/logo.png",
  "index 5555555..6666666 100644",
  "Binary files a/assets/logo.png and b/assets/logo.png differ",
].join("\n");

/** Builds a single-file diff whose body has exactly `lineCount` +/- lines. */
function makeLargeDiff(lineCount: number): string {
  const body = Array.from({ length: lineCount }, (_, i) => `+line ${i}`);
  return [
    "diff --git a/big.txt b/big.txt",
    "--- a/big.txt",
    "+++ b/big.txt",
    `@@ -0,0 +1,${lineCount} @@`,
    ...body,
  ].join("\n");
}

describe("parseUnifiedDiff", () => {
  it("splits a multi-file diff into per-file sections with +/- counts", () => {
    const files = parseUnifiedDiff(MULTI_FILE_DIFF);
    expect(files).toHaveLength(2);

    expect(files[0].path).toBe("src/alpha.ts");
    expect(files[0].added).toBe(2);
    expect(files[0].removed).toBe(1);
    expect(files[0].binary).toBe(false);

    expect(files[1].path).toBe("src/beta.ts");
    expect(files[1].added).toBe(0);
    expect(files[1].removed).toBe(1);
  });

  it("keeps hunk headers and change lines but strips git metadata", () => {
    const [file] = parseUnifiedDiff(MULTI_FILE_DIFF);
    expect(file.lines[0]).toBe("@@ -1,3 +1,4 @@");
    expect(file.lines).toContain("+const y = 3;");
    expect(file.lines).toContain("-const y = 2;");
    // `index`, `---`, `+++` lines never reach the render list (and the
    // markers must not be counted as removed/added lines).
    expect(file.lines.some((l) => l.startsWith("index "))).toBe(false);
    expect(file.lines.some((l) => l.startsWith("--- "))).toBe(false);
    expect(file.lines.some((l) => l.startsWith("+++ "))).toBe(false);
  });

  it("shows renames as old → new", () => {
    const files = parseUnifiedDiff(RENAME_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/old-name.ts → src/new-name.ts");
    expect(files[0].renamed).toBe(true);
    expect(files[0].lines).toHaveLength(0);
  });

  it("flags binary files", () => {
    const files = parseUnifiedDiff(BINARY_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].binary).toBe(true);
  });

  it("returns nothing for text without a diff --git header", () => {
    expect(parseUnifiedDiff("just some words")).toHaveLength(0);
  });
});

describe("DiffView", () => {
  it("renders per-file headers with counts and change lines", () => {
    render(<DiffView diff={MULTI_FILE_DIFF} />);
    expect(screen.getByText("src/alpha.ts")).toBeInTheDocument();
    expect(screen.getByText("src/beta.ts")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("+const z = 4;")).toBeInTheDocument();
    expect(screen.getByText("-old line")).toBeInTheDocument();
  });

  it("labels binary files instead of rendering a body", () => {
    render(<DiffView diff={BINARY_DIFF} />);
    expect(screen.getByText("assets/logo.png")).toBeInTheDocument();
    expect(screen.getByText("Binary files differ")).toBeInTheDocument();
  });

  it("renders nothing for undefined or empty input", () => {
    const { container: empty } = render(<DiffView diff={undefined} />);
    expect(empty.firstChild).toBeNull();

    const { container: blank } = render(<DiffView diff={"   \n  "} />);
    expect(blank.firstChild).toBeNull();
  });

  it("caps rendering at the line budget and shows a truncation notice", () => {
    const overBudget = DIFF_LINE_CAP + 50;
    const { container } = render(<DiffView diff={makeLargeDiff(overBudget)} />);
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
    // +1 hunk header, +DIFF_LINE_CAP body lines is the hard ceiling; the
    // omitted-lines note is separate. Everything past the cap must not mount.
    expect(screen.queryByText(`+line ${overBudget - 1}`)).not.toBeInTheDocument();
    const renderedLines = container.querySelectorAll(".whitespace-pre");
    expect(renderedLines.length).toBeLessThanOrEqual(DIFF_LINE_CAP);
  });

  it("falls back to a raw block for non-unified-diff text", () => {
    render(<DiffView diff={" 3 files changed, 10 insertions(+)"} />);
    expect(screen.getByText(/3 files changed/)).toBeInTheDocument();
  });
});
