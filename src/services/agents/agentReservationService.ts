import { FEATURE_FLAGS } from "../../constants";
import { localApi } from "../../core/api/localApi";
import { isTauri } from "../../runtime/runtimeEnvironment";
import type { Task } from "../../../types";
import { declarePlannedScope, reservationSetsOverlap } from "./scopeHeuristic";

export interface ScopeReservationEntry {
  runId: string;
  taskId: string;
  paths: string[];
  claimedAtMs?: number;
}

export interface ScopeReservationWaitEntry {
  runId: string;
  taskId: string;
  paths: string[];
  enqueuedAtMs?: number;
}

export interface ScopeReservationState {
  active: ScopeReservationEntry[];
  waiting: ScopeReservationWaitEntry[];
}

export interface ScopeReservationConflict {
  runId: string;
  taskId: string;
  paths: string[];
  overlap: string[];
}

export interface ScopeClaimResult {
  ok: boolean;
  conflict?: ScopeReservationConflict;
  waitPosition?: number;
  paths: string[];
}

type ReservationListener = (state: ScopeReservationState) => void;

/**
 * Daemon-backed scope reservation table (Refactor 3 / STR-2).
 * Prevents parallel runs from claiming overlapping file scopes.
 */
class AgentReservationService {
  private cache: ScopeReservationState = { active: [], waiting: [] };
  private listeners = new Set<ReservationListener>();

  subscribe(listener: ReservationListener): () => void {
    this.listeners.add(listener);
    listener(this.cache);
    void this.refresh();
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): ScopeReservationState {
    return this.cache;
  }

  getReservationForRun(runId: string): ScopeReservationEntry | undefined {
    return this.cache.active.find((r) => r.runId === runId);
  }

  private emit(): void {
    const snapshot = {
      active: [...this.cache.active],
      waiting: [...this.cache.waiting],
    };
    this.listeners.forEach((l) => l(snapshot));
  }

  private applyLocalClaim(
    runId: string,
    taskId: string,
    paths: string[],
    queueOnConflict: boolean,
  ): ScopeClaimResult {
    const conflict = this.checkOverlap(paths, runId);
    if (!conflict) {
      this.cache.active = this.cache.active.filter((a) => a.runId !== runId);
      this.cache.active.push({
        runId,
        taskId,
        paths,
        claimedAtMs: Date.now(),
      });
      this.cache.waiting = this.cache.waiting.filter((w) => w.runId !== runId);
      this.emit();
      return { ok: true, paths };
    }
    if (!queueOnConflict) {
      return { ok: false, conflict, paths };
    }
    if (!this.cache.waiting.some((w) => w.runId === runId)) {
      this.cache.waiting.push({
        runId,
        taskId,
        paths,
        enqueuedAtMs: Date.now(),
      });
    }
    const waitPosition =
      this.cache.waiting.findIndex((w) => w.runId === runId) + 1;
    this.emit();
    return { ok: false, conflict, waitPosition, paths };
  }

  private applyLocalRelease(runId: string): ScopeReservationWaitEntry | null {
    this.cache.active = this.cache.active.filter((a) => a.runId !== runId);
    this.cache.waiting = this.cache.waiting.filter((w) => w.runId !== runId);

    for (let i = 0; i < this.cache.waiting.length; i++) {
      const w = this.cache.waiting[i];
      if (this.checkOverlap(w.paths, w.runId)) continue;
      this.cache.active.push({
        runId: w.runId,
        taskId: w.taskId,
        paths: w.paths,
        claimedAtMs: Date.now(),
      });
      this.cache.waiting.splice(i, 1);
      this.emit();
      return w;
    }
    this.emit();
    return null;
  }

  async refresh(): Promise<void> {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED || !isTauri()) return;
    try {
      const state = await localApi.reservationList();
      if (!state) return;
      this.cache = {
        active: state.active ?? [],
        waiting: state.waiting ?? [],
      };
      this.emit();
    } catch (err) {
      console.warn("agentd reservation.list unavailable:", err);
    }
  }

  /**
   * Check whether `paths` overlap any active reservation (excluding `excludeRunId`).
   */
  checkOverlap(
    paths: string[],
    excludeRunId?: string,
  ): ScopeReservationConflict | undefined {
    for (const active of this.cache.active) {
      if (excludeRunId && active.runId === excludeRunId) continue;
      const overlap = reservationSetsOverlap(paths, active.paths);
      if (overlap.length > 0) {
        return {
          runId: active.runId,
          taskId: active.taskId,
          paths: active.paths,
          overlap,
        };
      }
    }
    return undefined;
  }

  /** Would dispatching this task overlap an active scope holder? */
  wouldTaskConflict(task: Task, excludeRunId?: string): ScopeReservationConflict | undefined {
    const paths = declarePlannedScope(task);
    return this.checkOverlap(paths, excludeRunId);
  }

  async claim(
    runId: string,
    task: Task,
    options?: { queueOnConflict?: boolean },
  ): Promise<ScopeClaimResult> {
    const paths = declarePlannedScope(task);
    const queueOnConflict = options?.queueOnConflict ?? true;

    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED && isTauri()) {
      try {
        const result = await localApi.reservationClaim(
          runId,
          task.id,
          paths,
          queueOnConflict,
        );
        await this.refresh();
        if (result) {
          return {
            ok: result.ok,
            conflict: result.conflict,
            waitPosition: result.waitPosition,
            paths,
          };
        }
      } catch (err) {
        console.warn("agentd reservation.claim failed, using local mirror:", err);
      }
    }

    return this.applyLocalClaim(runId, task.id, paths, queueOnConflict);
  }

  async release(runId: string): Promise<ScopeReservationWaitEntry | null> {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED && isTauri()) {
      try {
        const next = await localApi.reservationRelease(runId);
        await this.refresh();
        return next ?? null;
      } catch (err) {
        console.warn("agentd reservation.release failed, using local mirror:", err);
      }
    }
    return this.applyLocalRelease(runId);
  }

  /** Test-only reset. */
  resetForTests(): void {
    this.cache = { active: [], waiting: [] };
    this.emit();
  }
}

export const agentReservationService = new AgentReservationService();
export default agentReservationService;
