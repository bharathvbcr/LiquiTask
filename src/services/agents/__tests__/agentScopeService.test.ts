import { beforeEach, describe, expect, it } from "vitest";

import agentScopeService, { type PlannedFile } from "../agentScopeService";

describe("agentScopeService", () => {
  beforeEach(() => {
    agentScopeService.resetForTests();
  });

  it("treats a run with no registered scope as always in-scope", () => {
    const result = agentScopeService.checkPath("run-unregistered", "src/anything.ts");
    expect(result).toEqual({ inScope: true });
  });

  it("no-ops (clears) when plannedFiles is empty, leaving the task unrestricted", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/foo.ts", reason: "impl", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");
    expect(agentScopeService.checkPath("run-1", "src/anywhere-else.ts").inScope).toBe(false);

    // Clearing the task's plan (empty list) then rebinding should unrestrict it.
    agentScopeService.setScopeForTask("task-1", []);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");
    expect(agentScopeService.checkPath("run-1", "src/anywhere-else.ts")).toEqual({
      inScope: true,
    });
  });

  it("flags a path outside the whitelist as out of scope with a reason", () => {
    const plannedFiles: PlannedFile[] = [
      { path: "src/services/foo.ts", reason: "add feature", allowedChange: "modify" },
    ];
    agentScopeService.setScopeForTask("task-1", plannedFiles);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    const result = agentScopeService.checkPath("run-1", "src/services/bar.ts");
    expect(result.inScope).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toContain("src/services/bar.ts");
  });

  it("blocks writes to read_only entries", () => {
    const plannedFiles: PlannedFile[] = [
      { path: "src/config.ts", reason: "reference only", allowedChange: "read_only" },
    ];
    agentScopeService.setScopeForTask("task-1", plannedFiles);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    const result = agentScopeService.checkPath("run-1", "src/config.ts", "write");
    expect(result.inScope).toBe(false);
    expect(result.reason).toContain("read-only");
  });

  it("requires allowedChange === 'delete' for delete operations", () => {
    const plannedFiles: PlannedFile[] = [
      { path: "src/legacy.ts", reason: "cleanup candidate", allowedChange: "modify" },
    ];
    agentScopeService.setScopeForTask("task-1", plannedFiles);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    const deleteResult = agentScopeService.checkPath("run-1", "src/legacy.ts", "delete");
    expect(deleteResult.inScope).toBe(false);

    const writeResult = agentScopeService.checkPath("run-1", "src/legacy.ts", "write");
    expect(writeResult.inScope).toBe(true);

    agentScopeService.setScopeForTask("task-2", [
      { path: "src/old.ts", reason: "remove dead code", allowedChange: "delete" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-2", "task-2");
    const allowedDelete = agentScopeService.checkPath("run-2", "src/old.ts", "delete");
    expect(allowedDelete.inScope).toBe(true);
  });

  it("normalizes paths so ./foo/bar.ts, foo/bar.ts, and foo\\bar.ts all match", () => {
    const plannedFiles: PlannedFile[] = [
      { path: "./foo/bar.ts", reason: "impl", allowedChange: "create" },
    ];
    agentScopeService.setScopeForTask("task-1", plannedFiles);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    expect(agentScopeService.checkPath("run-1", "foo/bar.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "./foo/bar.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "foo\\bar.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "foo/bar.ts/").inScope).toBe(true);
  });

  it("allows any file under a directory-scoped entry (trailing slash)", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/services/agents/", reason: "subsystem work", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    expect(agentScopeService.checkPath("run-1", "src/services/agents/foo.ts").inScope).toBe(true);
    expect(
      agentScopeService.checkPath("run-1", "src/services/agents/nested/bar.ts").inScope,
    ).toBe(true);
    expect(agentScopeService.checkPath("run-1", "src/services/other.ts").inScope).toBe(false);
  });

  it("supports single-star globs that do not cross directory boundaries", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/services/*.ts", reason: "service files", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    expect(agentScopeService.checkPath("run-1", "src/services/foo.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "src/services/nested/bar.ts").inScope).toBe(false);
  });

  it("supports globstar patterns that cross directory boundaries", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/services/**", reason: "whole subsystem", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    expect(agentScopeService.checkPath("run-1", "src/services/foo.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "src/services/nested/bar.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "src/other.ts").inScope).toBe(false);
  });

  it("prefers an exact read_only entry over a broader writable directory entry", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/services/", reason: "subsystem work", allowedChange: "modify" },
      { path: "src/services/config.ts", reason: "reference only", allowedChange: "read_only" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");

    // A sibling under the directory entry is writable...
    expect(agentScopeService.checkPath("run-1", "src/services/foo.ts").inScope).toBe(true);
    // ...but the specifically read-only file stays blocked (exact match wins).
    const ro = agentScopeService.checkPath("run-1", "src/services/config.ts", "write");
    expect(ro.inScope).toBe(false);
    expect(ro.reason).toContain("read-only");
  });

  it("clears scope for a run on clearScopeForRun, reverting to unrestricted", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/only.ts", reason: "impl", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");
    expect(agentScopeService.checkPath("run-1", "src/other.ts").inScope).toBe(false);

    agentScopeService.clearScopeForRun("run-1");
    expect(agentScopeService.checkPath("run-1", "src/other.ts")).toEqual({ inScope: true });
  });

  it("bindTaskScopeToRun is a no-op restriction when the task has no scope registered", () => {
    agentScopeService.bindTaskScopeToRun("run-1", "task-never-planned");
    expect(agentScopeService.checkPath("run-1", "src/whatever.ts")).toEqual({ inScope: true });
  });

  it("rejects path traversal via .. segments", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/services/foo.ts", reason: "impl", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");
    agentScopeService.setRunRoot("run-1", "/repo");

    expect(agentScopeService.checkPath("run-1", "src/services/../other.ts").inScope).toBe(false);
    expect(agentScopeService.checkPath("run-1", "../../etc/passwd").inScope).toBe(false);
  });

  it("resolves absolute paths under the run root", () => {
    agentScopeService.setScopeForTask("task-1", [
      { path: "src/foo.ts", reason: "impl", allowedChange: "modify" },
    ]);
    agentScopeService.bindTaskScopeToRun("run-1", "task-1");
    agentScopeService.setRunRoot("run-1", "/repo/project");

    expect(agentScopeService.checkPath("run-1", "/repo/project/src/foo.ts").inScope).toBe(true);
    expect(agentScopeService.checkPath("run-1", "/other/src/foo.ts").inScope).toBe(false);
  });
});
