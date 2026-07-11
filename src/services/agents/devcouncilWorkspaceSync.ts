/**
 * DevCouncil workspace sync: the one place that decides what "set up DevCouncil
 * for this workspace" means, so the auto-on-open hook, the manual "Sync Now"
 * button, and any future caller all behave identically.
 *
 * When a workspace is set and DevCouncil is detected, we (best-effort, in the
 * background):
 *   1. regenerate the repo map (`dev map`) when it's missing or stale,
 *   2. inject the team's skills into `.claude/skills/` so any agent runtime in
 *      the repo can discover them,
 *   3. mirror DevCouncil's evidence graph into LiquiTask (task-card provenance),
 *   4. prewarm the repo-map context + tracked-file list so the first run is fast.
 *
 * DevCouncil is optional: when the CLI is absent we do nothing; when the CLI is
 * present but the repo isn't initialized we don't touch the repo — instead we
 * report `needsInit` so the caller can hand initialization to an agent (via a
 * board task) rather than shelling out to `dev init` behind the user's back.
 */
import { isTauri } from "../../runtime/runtimeEnvironment";
import devcouncilService, { type DevCouncilStatus } from "./devcouncilService";
import { injectSkillsIntoWorkspace, type SkillInjectionResult } from "./workspaceSkillsInjector";
import {
  ensureWorkspaceGitignore,
  type WorkspaceGitignoreResult,
} from "./workspaceGitignoreInjector";
import type { Task } from "../../../types";

/** Regenerate the repo map when it is missing or older than this (mirrors devcouncilService). */
const REPO_MAP_STALE_SECS = 7 * 24 * 60 * 60;

const OFFLINE_STATUS: DevCouncilStatus = {
  cliAvailable: false,
  initialized: false,
  repoMapPresent: false,
};

export interface DevCouncilSyncSteps {
  mapRegenerated: boolean;
  skills: SkillInjectionResult | null;
  evidenceMirrored: boolean;
  contextPrewarmed: boolean;
  gitignoreUpdated: boolean;
}

export interface DevCouncilSyncResult {
  status: DevCouncilStatus;
  /** True when we actually performed sync actions (repo was initialized). */
  ran: boolean;
  /** CLI present but repo uninitialized — caller should offer agent-run init. */
  needsInit: boolean;
  steps: DevCouncilSyncSteps;
}

export interface DevCouncilSyncOptions {
  /** Manual "Sync Now": regenerate the map even if it's fresh. */
  force?: boolean;
  regenerateMap?: boolean;
  injectSkills?: boolean;
  mirrorEvidence?: boolean;
  prewarmContext?: boolean;
  ensureGitignore?: boolean;
}

const EMPTY_STEPS: DevCouncilSyncSteps = {
  mapRegenerated: false,
  skills: null,
  evidenceMirrored: false,
  contextPrewarmed: false,
  gitignoreUpdated: false,
};

/**
 * Run the sync for a workspace. Every step is best-effort and degrades to a
 * `false`/`null` result instead of throwing, so a single failing step never
 * aborts the rest (or the caller).
 */
export async function syncDevCouncilWorkspace(
  workingDir: string,
  options: DevCouncilSyncOptions = {},
): Promise<DevCouncilSyncResult> {
  const {
    force = false,
    regenerateMap = true,
    injectSkills = true,
    mirrorEvidence = true,
    prewarmContext = true,
    ensureGitignore = true,
  } = options;

  if (!isTauri() || !workingDir) {
    return { status: OFFLINE_STATUS, ran: false, needsInit: false, steps: { ...EMPTY_STEPS } };
  }

  const status = await devcouncilService.getStatus(workingDir);
  if (!status.cliAvailable) {
    return { status, ran: false, needsInit: false, steps: { ...EMPTY_STEPS } };
  }
  if (!status.initialized) {
    // Detected but uninitialized: hand init to an agent, don't touch the repo here.
    return { status, ran: false, needsInit: true, steps: { ...EMPTY_STEPS } };
  }

  const steps: DevCouncilSyncSteps = { ...EMPTY_STEPS };

  if (regenerateMap) {
    const stale =
      force ||
      !status.repoMapPresent ||
      (status.repoMapAgeSecs !== undefined && status.repoMapAgeSecs > REPO_MAP_STALE_SECS);
    if (stale) {
      try {
        const result = await devcouncilService.generateRepoMap(workingDir);
        steps.mapRegenerated = result.success;
      } catch {
        // best-effort
      }
    }
  }

  if (injectSkills) {
    try {
      steps.skills = await injectSkillsIntoWorkspace(workingDir);
    } catch {
      steps.skills = null;
    }
  }

  if (ensureGitignore) {
    try {
      const gitignore: WorkspaceGitignoreResult = await ensureWorkspaceGitignore(workingDir);
      steps.gitignoreUpdated = gitignore.updated;
    } catch {
      steps.gitignoreUpdated = false;
    }
  }

  if (mirrorEvidence) {
    try {
      await devcouncilService.getEvidenceGraph(workingDir);
      steps.evidenceMirrored = true;
    } catch {
      // best-effort
    }
  }

  if (prewarmContext) {
    try {
      await Promise.all([
        devcouncilService.getRepoMapContext(workingDir),
        devcouncilService.getRepoFiles(workingDir),
      ]);
      steps.contextPrewarmed = true;
    } catch {
      // best-effort
    }
  }

  return { status, ran: true, needsInit: false, steps };
}

/** A one-line human summary of what a sync did, for a toast. */
export function summarizeSync(result: DevCouncilSyncResult): string {
  const parts: string[] = [];
  if (result.steps.mapRegenerated) parts.push("repo map refreshed");
  if (result.steps.skills && result.steps.skills.injected > 0) {
    parts.push(`${result.steps.skills.injected} skill file(s) injected`);
  }
  if (result.steps.gitignoreUpdated) parts.push("gitignore updated");
  if (result.steps.evidenceMirrored) parts.push("evidence mirrored");
  if (result.steps.contextPrewarmed) parts.push("context prewarmed");
  return parts.length > 0 ? `DevCouncil synced — ${parts.join(", ")}.` : "DevCouncil is up to date.";
}

/**
 * The board task that hands DevCouncil initialization to a coding agent. Pure so
 * the exact instructions are easy to test; the caller creates it and dispatches
 * it to the Claude Code / default agent.
 */
export function buildDevCouncilInitTask(workingDir: string): Partial<Task> {
  const summary = [
    "Set up DevCouncil for this repository so LiquiTask can gate runs with plan/verify",
    "and inject repo-map context into agent prompts.",
    "",
    "Steps:",
    "1. Check the DevCouncil CLI is available (`dev --version`); if missing, install it",
    "   (`npm install -g devcouncil`, or the local checkout if you have one).",
    "2. Run `dev init` in the repo root to create the `.devcouncil/` directory.",
    "3. Run `dev map` to generate `.devcouncil/repo_map.json`.",
    "4. Confirm `.devcouncil/config.yaml` and `.devcouncil/repo_map.json` exist.",
    "5. Ensure the LiquiTask agent gitignore block is present in `.gitignore`",
    "   (DevCouncil state, agent runtime dirs, worktrees, logs — managed by LiquiTask sync).",
    "",
    `Working directory: ${workingDir}`,
  ].join("\n");

  return {
    title: "Initialize DevCouncil in this workspace",
    summary,
    priority: "high",
    tags: ["devcouncil", "devcouncil:init"],
  };
}
