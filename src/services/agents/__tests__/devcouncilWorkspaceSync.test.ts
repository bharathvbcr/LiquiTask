import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
vi.mock("../devcouncilService", () => ({
  default: {
    getStatus: vi.fn(),
    generateRepoMap: vi.fn(),
    getEvidenceGraph: vi.fn(),
    getRepoMapContext: vi.fn(),
    getRepoFiles: vi.fn(),
  },
}));
vi.mock("../workspaceSkillsInjector", () => ({
  injectSkillsIntoWorkspace: vi.fn(),
}));
vi.mock("../workspaceGitignoreInjector", () => ({
  ensureWorkspaceGitignore: vi.fn(),
}));

import devcouncilService from "../devcouncilService";
import { injectSkillsIntoWorkspace } from "../workspaceSkillsInjector";
import { ensureWorkspaceGitignore } from "../workspaceGitignoreInjector";
import {
  buildDevCouncilInitTask,
  summarizeSync,
  syncDevCouncilWorkspace,
  type DevCouncilSyncResult,
} from "../devcouncilWorkspaceSync";

const svc = devcouncilService as unknown as {
  getStatus: Mock;
  generateRepoMap: Mock;
  getEvidenceGraph: Mock;
  getRepoMapContext: Mock;
  getRepoFiles: Mock;
};
const inject = injectSkillsIntoWorkspace as unknown as Mock;
const ensureGitignore = ensureWorkspaceGitignore as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  svc.getStatus.mockResolvedValue({
    cliAvailable: true,
    initialized: true,
    repoMapPresent: true,
    repoMapAgeSecs: 10,
  });
  svc.generateRepoMap.mockResolvedValue({ success: true, output: "" });
  svc.getEvidenceGraph.mockResolvedValue({ requirements: [], tasks: [], evidence: [] });
  svc.getRepoMapContext.mockResolvedValue(null);
  svc.getRepoFiles.mockResolvedValue([]);
  inject.mockResolvedValue({ injected: 3, baseDir: "/repo/.claude/skills/liquitask" });
  ensureGitignore.mockResolvedValue({ updated: true });
});

describe("syncDevCouncilWorkspace", () => {
  it("does nothing when the DevCouncil CLI is unavailable", async () => {
    svc.getStatus.mockResolvedValue({
      cliAvailable: false,
      initialized: false,
      repoMapPresent: false,
    });
    const result = await syncDevCouncilWorkspace("/repo");
    expect(result.ran).toBe(false);
    expect(result.needsInit).toBe(false);
    expect(svc.generateRepoMap).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  it("flags needsInit (and touches nothing) when detected but uninitialized", async () => {
    svc.getStatus.mockResolvedValue({
      cliAvailable: true,
      initialized: false,
      repoMapPresent: false,
    });
    const result = await syncDevCouncilWorkspace("/repo");
    expect(result.needsInit).toBe(true);
    expect(result.ran).toBe(false);
    expect(svc.generateRepoMap).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
    expect(svc.getEvidenceGraph).not.toHaveBeenCalled();
  });

  it("runs all steps on an initialized repo but skips a fresh map", async () => {
    const result = await syncDevCouncilWorkspace("/repo");
    expect(result.ran).toBe(true);
    expect(result.needsInit).toBe(false);
    expect(svc.generateRepoMap).not.toHaveBeenCalled(); // fresh
    expect(result.steps.mapRegenerated).toBe(false);
    expect(inject).toHaveBeenCalledWith("/repo");
    expect(result.steps.skills?.injected).toBe(3);
    expect(ensureGitignore).toHaveBeenCalledWith("/repo");
    expect(result.steps.gitignoreUpdated).toBe(true);
    expect(result.steps.evidenceMirrored).toBe(true);
    expect(result.steps.contextPrewarmed).toBe(true);
  });

  it("regenerates the map when it is missing/stale", async () => {
    svc.getStatus.mockResolvedValue({
      cliAvailable: true,
      initialized: true,
      repoMapPresent: false,
    });
    const result = await syncDevCouncilWorkspace("/repo");
    expect(svc.generateRepoMap).toHaveBeenCalledWith("/repo");
    expect(result.steps.mapRegenerated).toBe(true);
  });

  it("force regenerates the map even when it is fresh", async () => {
    await syncDevCouncilWorkspace("/repo", { force: true });
    expect(svc.generateRepoMap).toHaveBeenCalledWith("/repo");
  });

  it("respects step toggles", async () => {
    await syncDevCouncilWorkspace("/repo", {
      injectSkills: false,
      mirrorEvidence: false,
      ensureGitignore: false,
    });
    expect(inject).not.toHaveBeenCalled();
    expect(ensureGitignore).not.toHaveBeenCalled();
    expect(svc.getEvidenceGraph).not.toHaveBeenCalled();
    expect(svc.getRepoMapContext).toHaveBeenCalled(); // prewarm still on
  });

  it("does not throw if a step fails; other steps still run", async () => {
    svc.generateRepoMap.mockRejectedValue(new Error("map boom"));
    svc.getStatus.mockResolvedValue({
      cliAvailable: true,
      initialized: true,
      repoMapPresent: false,
    });
    const result = await syncDevCouncilWorkspace("/repo");
    expect(result.ran).toBe(true);
    expect(result.steps.mapRegenerated).toBe(false);
    expect(inject).toHaveBeenCalled();
  });
});

describe("summarizeSync", () => {
  it("lists the steps that ran", () => {
    const result: DevCouncilSyncResult = {
      status: { cliAvailable: true, initialized: true, repoMapPresent: true },
      ran: true,
      needsInit: false,
      steps: {
        mapRegenerated: true,
        skills: { injected: 2, baseDir: "/repo/.claude/skills/liquitask" },
        evidenceMirrored: true,
        contextPrewarmed: false,
        gitignoreUpdated: true,
      },
    };
    const text = summarizeSync(result);
    expect(text).toContain("repo map refreshed");
    expect(text).toContain("2 skill file(s) injected");
    expect(text).toContain("gitignore updated");
    expect(text).toContain("evidence mirrored");
  });

  it("reports up-to-date when nothing changed", () => {
    const result: DevCouncilSyncResult = {
      status: { cliAvailable: true, initialized: true, repoMapPresent: true },
      ran: true,
      needsInit: false,
      steps: {
        mapRegenerated: false,
        skills: { injected: 0, baseDir: null },
        evidenceMirrored: false,
        contextPrewarmed: false,
        gitignoreUpdated: false,
      },
    };
    expect(summarizeSync(result)).toBe("DevCouncil is up to date.");
  });
});

describe("buildDevCouncilInitTask", () => {
  it("builds a high-priority, tagged init task naming the working dir", () => {
    const task = buildDevCouncilInitTask("/repo/app");
    expect(task.title).toContain("Initialize DevCouncil");
    expect(task.priority).toBe("high");
    expect(task.tags).toContain("devcouncil:init");
    expect(task.summary).toContain("/repo/app");
    expect(task.summary).toContain("dev init");
    expect(task.summary).toContain("gitignore");
  });
});
