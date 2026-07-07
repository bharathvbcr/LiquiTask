import { isTauri } from "../../runtime/runtimeEnvironment";
import {
  nativeDevMirrorEvidence,
  nativeDevRepoFiles,
  nativeListDevcouncilEvidence,
  nativeListDevcouncilRequirements,
  nativeListDevcouncilTasks,
} from "../nativeBridge";
import type { EvidenceGraph } from "./devcouncilEvidence";

/**
 * DevCouncil workspace integration: install/init detection, repo-map
 * management, and compact repo-map context for agent prompts.
 *
 * DevCouncil is optional — every call degrades to "not available" instead of
 * throwing, so the board works identically without it.
 */

export interface DevCouncilStatus {
  cliAvailable: boolean;
  cliPath?: string;
  version?: string;
  initialized: boolean;
  repoMapPresent: boolean;
  repoMapAgeSecs?: number;
  repoMapFileCount?: number;
  repoMapSubsystemCount?: number;
}

export interface DevCliRunResult {
  success: boolean;
  output: string;
}

/** Auto-discovery snapshot from `agent_dev_discover`. */
export interface DevCouncilDiscovery {
  cliAvailable: boolean;
  cliPath?: string;
  /** Verified DevCouncil checkouts on this machine (e.g. ~/Code/DevCouncil). */
  localCheckouts: string[];
  /** Installer tools available for lazy install, in preference order. */
  installers: string[];
}

export interface DevCouncilBootstrapResult {
  status: DevCouncilStatus;
  installed?: boolean;
  initialized?: boolean;
  mapGenerated?: boolean;
  log: string[];
}

export const DEVCOUNCIL_INSTALL_COMMAND = "npm install -g devcouncil";

/** Regenerate the repo map when it is missing or older than this. */
const REPO_MAP_STALE_SECS = 7 * 24 * 60 * 60;

const OFFLINE_STATUS: DevCouncilStatus = {
  cliAvailable: false,
  initialized: false,
  repoMapPresent: false,
};

class DevCouncilService {
  /** workingDir -> repo-map prompt context, cached per app session. */
  private repoMapCache = new Map<string, Promise<string | null>>();
  /** workingDir -> real tracked-file list, cached per app session. */
  private repoFilesCache = new Map<string, Promise<string[]>>();
  /** Working dirs with a background map refresh already triggered this session. */
  private mapRefreshInFlight = new Set<string>();

  async getStatus(workingDir: string): Promise<DevCouncilStatus> {
    if (!isTauri() || !workingDir) return OFFLINE_STATUS;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DevCouncilStatus>("agent_dev_status", { workingDir });
    } catch {
      return OFFLINE_STATUS;
    }
  }

  async isCliAvailable(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("agent_dev_cli_available");
    } catch {
      return false;
    }
  }

  /** `dev init` in the working dir (creates .devcouncil/). */
  async init(workingDir: string): Promise<DevCliRunResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DevCliRunResult>("agent_dev_init", { workingDir });
  }

  /** `dev map` — (re)generate .devcouncil/repo_map.json. */
  async generateRepoMap(workingDir: string): Promise<DevCliRunResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<DevCliRunResult>("agent_dev_map", { workingDir });
    this.repoMapCache.delete(workingDir);
    this.repoFilesCache.delete(workingDir);
    return result;
  }

  /** `npm install -g devcouncil` — blocking; caller shows progress UI. */
  async install(): Promise<DevCliRunResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DevCliRunResult>("agent_dev_install");
  }

  /** Auto-discovery: CLI location, local checkouts, available installers. */
  async discover(): Promise<DevCouncilDiscovery> {
    if (!isTauri()) {
      return { cliAvailable: false, localCheckouts: [], installers: [] };
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DevCouncilDiscovery>("agent_dev_discover");
    } catch {
      return { cliAvailable: false, localCheckouts: [], installers: [] };
    }
  }

  /**
   * Lazy install from a local checkout (uv → pipx), falling back to the npm
   * registry. Blocking; caller shows progress UI.
   */
  async installLocal(sourceDir?: string): Promise<DevCliRunResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DevCliRunResult>("agent_dev_install_local", {
      sourceDir: sourceDir ?? null,
    });
  }

  /**
   * One-call bootstrap for a workspace: discover → (optionally) lazy-install
   * from the local checkout → `dev init` → `dev map`. Used by the Agent
   * Settings preflight; every step degrades gracefully and is reported in
   * `log` so the UI can show exactly what happened.
   */
  async bootstrap(
    workingDir: string,
    options?: { autoInstall?: boolean; autoInit?: boolean },
  ): Promise<DevCouncilBootstrapResult> {
    const log: string[] = [];
    const result: DevCouncilBootstrapResult = { status: OFFLINE_STATUS, log };
    if (!isTauri() || !workingDir) return result;

    let status = await this.getStatus(workingDir);

    if (!status.cliAvailable && options?.autoInstall) {
      const discovery = await this.discover();
      const source = discovery.localCheckouts[0];
      log.push(
        source
          ? `Installing DevCouncil from local checkout ${source}…`
          : "Installing DevCouncil from the npm registry…",
      );
      try {
        const install = await this.installLocal(source);
        result.installed = install.success;
        log.push(install.output.split("\n").slice(-3).join("\n"));
        if (install.success) status = await this.getStatus(workingDir);
      } catch (err) {
        log.push(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (status.cliAvailable && !status.initialized && options?.autoInit) {
      log.push("Initialising DevCouncil in this workspace (dev init)…");
      try {
        const init = await this.init(workingDir);
        result.initialized = init.success;
        if (init.success) status = await this.getStatus(workingDir);
      } catch (err) {
        log.push(`dev init failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (status.cliAvailable && status.initialized) {
      const stale =
        !status.repoMapPresent ||
        (status.repoMapAgeSecs !== undefined && status.repoMapAgeSecs > REPO_MAP_STALE_SECS);
      if (stale) {
        log.push("Generating repo map (dev map)…");
        try {
          const map = await this.generateRepoMap(workingDir);
          result.mapGenerated = map.success;
          if (map.success) status = await this.getStatus(workingDir);
        } catch (err) {
          log.push(`dev map failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    result.status = status;
    return result;
  }

  /**
   * Keep the repo-map context injection fresh: when a workspace is
   * DevCouncil-initialised but its map is missing/stale, regenerate it in the
   * background so the NEXT run gets an up-to-date map. Never blocks a run.
   * De-duplicated per working dir per session.
   */
  ensureFreshMap(workingDir: string): void {
    if (!isTauri() || !workingDir || this.mapRefreshInFlight.has(workingDir)) return;
    this.mapRefreshInFlight.add(workingDir);
    void (async () => {
      try {
        const status = await this.getStatus(workingDir);
        if (!status.cliAvailable || !status.initialized) return;
        const stale =
          !status.repoMapPresent ||
          (status.repoMapAgeSecs !== undefined && status.repoMapAgeSecs > REPO_MAP_STALE_SECS);
        if (stale) {
          await this.generateRepoMap(workingDir);
        }
      } catch {
        // Best-effort background refresh.
      }
    })();
  }

  /**
   * Compact repo-map summary (subsystems, entry points, critical files) for
   * agent prompt injection. Cached per working dir for the app session;
   * null when DevCouncil/repo map is absent.
   */
  getRepoMapContext(workingDir: string): Promise<string | null> {
    if (!isTauri() || !workingDir) return Promise.resolve(null);
    let cached = this.repoMapCache.get(workingDir);
    if (!cached) {
      cached = (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          return await invoke<string | null>("agent_dev_repo_map_summary", { workingDir });
        } catch {
          return null;
        }
      })();
      this.repoMapCache.set(workingDir, cached);
    }
    return cached;
  }

  /**
   * Mirror DevCouncil's evidence graph (Requirement -> Task -> Evidence) into
   * LiquiTask's store and read it back for the task-card provenance panel. The
   * mirror runs first so the read reflects the latest plan/verify state; every
   * step degrades to an empty graph when DevCouncil isn't present.
   */
  async getEvidenceGraph(workingDir?: string): Promise<EvidenceGraph> {
    const empty: EvidenceGraph = { requirements: [], tasks: [], evidence: [] };
    if (!isTauri()) return empty;
    try {
      // Mirror only when we know the repo (fresh provenance); the read itself hits
      // LiquiTask's global store, so a task card can show already-mirrored evidence
      // even without a working dir in hand.
      if (workingDir) await nativeDevMirrorEvidence(workingDir);
      const [requirements, tasks, evidence] = await Promise.all([
        nativeListDevcouncilRequirements(),
        nativeListDevcouncilTasks(),
        nativeListDevcouncilEvidence(),
      ]);
      return { requirements, tasks, evidence };
    } catch {
      return empty;
    }
  }

  /**
   * The repo's actual tracked files (from `.devcouncil/repo_map.json`), cached
   * per working dir. Empty when DevCouncil isn't present or the repo is unmapped;
   * used to ground default-run prompts on real paths.
   */
  getRepoFiles(workingDir: string): Promise<string[]> {
    if (!isTauri() || !workingDir) return Promise.resolve([]);
    let cached = this.repoFilesCache.get(workingDir);
    if (!cached) {
      cached = nativeDevRepoFiles(workingDir).catch(() => []);
      this.repoFilesCache.set(workingDir, cached);
    }
    return cached;
  }

  clearCaches(): void {
    this.repoMapCache.clear();
    this.repoFilesCache.clear();
    this.mapRefreshInFlight.clear();
  }
}

export const devcouncilService = new DevCouncilService();
export default devcouncilService;
