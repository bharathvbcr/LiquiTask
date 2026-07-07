import { describe, expect, it } from "vitest";
import type { AgentProfile, Project, Task } from "../../../../types";
import { resolveAgentWorkspace } from "../resolveAgentWorkspace";

const task = (over: Partial<Task> = {}): Task =>
  ({ id: "t1", projectId: "portfolio", title: "Redesign pill", assignee: "Dev", ...over } as Task);

const agent = (workingDir: string): AgentProfile =>
  ({ id: "a1", name: "Dev", workingDir } as AgentProfile);

const project = (id: string, name: string, workspacePaths?: string[]): Project =>
  ({ id, name, type: "project", workspacePaths } as Project);

const PORTFOLIO = "/Users/bharath/Code/Portfolio";
const SCHOLARLM = "/Users/bharath/Code/ScholarLM";

describe("resolveAgentWorkspace", () => {
  it("overrides a mismatched agent folder with the project's workspace (the ScholarLM bug)", () => {
    const res = resolveAgentWorkspace(
      task({ projectId: "portfolio" }),
      agent(SCHOLARLM),
      [project("portfolio", "Portfolio", [PORTFOLIO])],
    );
    expect(res).toEqual({
      ok: true,
      workingDir: PORTFOLIO,
      overrodeAgentDir: true,
      projectName: "Portfolio",
    });
  });

  it("keeps the agent folder when it already belongs to the project", () => {
    const res = resolveAgentWorkspace(
      task({ projectId: "portfolio" }),
      agent(PORTFOLIO),
      [project("portfolio", "Portfolio", [PORTFOLIO, "/some/other"])],
    );
    expect(res).toMatchObject({ ok: true, workingDir: PORTFOLIO, overrodeAgentDir: false });
  });

  it("blocks when the project has no workspace linked", () => {
    const res = resolveAgentWorkspace(
      task({ projectId: "portfolio" }),
      agent(SCHOLARLM),
      [project("portfolio", "Portfolio", [])],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Portfolio");
  });

  it("blocks when the task is not linked to any known project", () => {
    const res = resolveAgentWorkspace(task({ projectId: "ghost" }), agent(SCHOLARLM), [
      project("portfolio", "Portfolio", [PORTFOLIO]),
    ]);
    expect(res.ok).toBe(false);
  });

  it("ignores blank workspace path entries", () => {
    const res = resolveAgentWorkspace(
      task({ projectId: "portfolio" }),
      agent(SCHOLARLM),
      [project("portfolio", "Portfolio", ["  ", "", PORTFOLIO])],
    );
    expect(res).toMatchObject({ ok: true, workingDir: PORTFOLIO, overrodeAgentDir: true });
  });
});
