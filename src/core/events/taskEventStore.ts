import type { Task } from "../../../types";
import { isTauri } from "../../runtime/runtimeEnvironment";
import { replayTaskEvents } from "./taskEventReducer";
import {
  draftEvent,
  serializeTask,
  type TaskEvent,
  type TaskEventDraft,
} from "./taskEvents";

/**
 * Append-only task event store — the durable write-ahead log the board is
 * rebuilt from.
 *
 * Adapters:
 * - Desktop (Tauri): SQLite `task_events` table via the `task_events_*`
 *   commands (same app-data DB as the task snapshot store). Appends are
 *   transactional — a batch lands entirely or not at all.
 * - Web: a dedicated IndexedDB database. Same contract, browser-local.
 *
 * Consistency model (full event sourcing):
 * 1. `append` is awaited BEFORE projections are persisted — the log is the
 *    source of truth and the legacy stores are derived read models.
 * 2. Appends are serialized through an internal chain so concurrent callers
 *    (drag & drop, MCP tools, automation) get strict ordering.
 * 3. On boot, `initialize` replays the log; the legacy snapshot is only used
 *    for the one-time genesis import or as a degraded fallback when the log
 *    is unavailable (the store then reports `isDegraded()`).
 * 4. Every append is broadcast (in-process listeners + a Tauri event) so the
 *    board UI, terminal shell, and agent surfaces converge on the same state.
 */

export const TASK_EVENTS_BROADCAST = "liquitask://task-events-appended";

type Listener = (events: TaskEvent[]) => void;

interface EventStoreAdapter {
  append(events: TaskEvent[]): Promise<TaskEvent[]>;
  read(sinceSeq?: number): Promise<TaskEvent[]>;
  count(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Native adapter (SQLite via Tauri)
// ---------------------------------------------------------------------------

class NativeAdapter implements EventStoreAdapter {
  async append(events: TaskEvent[]): Promise<TaskEvent[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    const seqs = await invoke<number[]>("task_events_append", {
      events: events.map((e) => ({
        id: e.id,
        streamId: e.streamId,
        eventType: e.type,
        payload: JSON.stringify(e.payload),
        actor: e.actor,
        runId: e.runId ?? null,
        ts: e.ts,
        v: e.v,
      })),
    });
    return events.map((e, i) => ({ ...e, seq: seqs[i] }));
  }

  async read(sinceSeq?: number): Promise<TaskEvent[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    const rows = await invoke<
      Array<{
        seq: number;
        id: string;
        streamId: string;
        eventType: string;
        payload: string;
        actor: string;
        runId?: string | null;
        ts: string;
        v: number;
      }>
    >("task_events_read", { sinceSeq: sinceSeq ?? null, limit: null });
    return rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      streamId: r.streamId,
      type: r.eventType as TaskEvent["type"],
      payload: safeParse(r.payload),
      actor: r.actor,
      runId: r.runId ?? undefined,
      ts: r.ts,
      v: 1,
    }));
  }

  async count(): Promise<number> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<number>("task_events_count");
  }
}

function safeParse(raw: string): TaskEvent["payload"] {
  try {
    return JSON.parse(raw) as TaskEvent["payload"];
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Web adapter (IndexedDB)
// ---------------------------------------------------------------------------

const IDB_NAME = "liquitask-events";
const IDB_STORE = "task_events";

class WebAdapter implements EventStoreAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
          reject(new Error("IndexedDB unavailable"));
          return;
        }
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: "seq", autoIncrement: true });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      });
    }
    return this.dbPromise;
  }

  async append(events: TaskEvent[]): Promise<TaskEvent[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const out: TaskEvent[] = [];
      for (const event of events) {
        const record = { ...event, payload: event.payload };
        const req = store.add(record);
        req.onsuccess = () => {
          out.push({ ...event, seq: Number(req.result) });
        };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB append failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB append aborted"));
    });
  }

  async read(sinceSeq?: number): Promise<TaskEvent[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const range =
        sinceSeq !== undefined ? IDBKeyRange.lowerBound(sinceSeq, true) : undefined;
      const req = tx.objectStore(IDB_STORE).getAll(range);
      req.onsuccess = () => resolve((req.result ?? []) as TaskEvent[]);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
  }

  async count(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB count failed"));
    });
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type BootSource = "events" | "genesis" | "legacy-fallback";

class TaskEventStore {
  private adapter: EventStoreAdapter | null = null;
  private degraded = false;
  /** True once `initialize` opened the log successfully. Appends that fail
   * BEFORE a successful initialize mark the store degraded instead of
   * rejecting mutations — environments without a usable log (tests, private
   * browsing) keep working on the legacy stores. */
  private initializedOk = false;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();
  private windowTag = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  private externalUnlisten: (() => void) | null = null;

  private ensureAdapter(): EventStoreAdapter {
    if (!this.adapter) {
      this.adapter = isTauri() ? new NativeAdapter() : new WebAdapter();
    }
    return this.adapter;
  }

  /** True when the log could not be opened — mutations proceed legacy-only. */
  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Open the log and rebuild board state.
   * - Empty log + existing legacy tasks → one-time genesis import.
   * - Populated log → replay (the log wins over the snapshot).
   * - Log unavailable → degraded mode, legacy snapshot is served as-is.
   */
  async initialize(legacyTasks: Task[]): Promise<{ tasks: Task[]; source: BootSource }> {
    try {
      const adapter = this.ensureAdapter();
      const total = await adapter.count();

      if (total === 0) {
        if (legacyTasks.length > 0) {
          const drafts = legacyTasks.map((task) =>
            draftEvent({
              streamId: task.id,
              type: "task.imported",
              payload: { task: serializeTask(task), changed: ["*"] },
              actor: "system",
            }),
          );
          await adapter.append(drafts);
        }
        this.initializedOk = true;
        void this.listenForExternalAppends();
        return { tasks: legacyTasks, source: "genesis" };
      }

      const events = await adapter.read();
      const tasks = replayTaskEvents(events);
      this.initializedOk = true;
      void this.listenForExternalAppends();
      return { tasks, source: "events" };
    } catch (err) {
      console.warn("[taskEventStore] log unavailable — degraded to legacy snapshot:", err);
      this.degraded = true;
      return { tasks: legacyTasks, source: "legacy-fallback" };
    }
  }

  /**
   * Append events to the log (write-ahead). Serialized: concurrent callers
   * are ordered. Throws when the log is required but unavailable — callers
   * decide whether to dead-letter or roll back their optimistic update.
   */
  append(drafts: TaskEventDraft[]): Promise<TaskEvent[]> {
    if (drafts.length === 0) return Promise.resolve([]);
    if (this.degraded) {
      return Promise.reject(new Error("Task event log unavailable (degraded mode)"));
    }
    const events = drafts.map(draftEvent);
    const next = this.chain.then(async () => {
      try {
        const appended = await this.ensureAdapter().append(events);
        this.notify(appended);
        void this.broadcast(appended);
        return appended;
      } catch (err) {
        // A failure before the log ever opened successfully means there IS no
        // log here — degrade permanently rather than rejecting every mutation.
        if (!this.initializedOk) this.degraded = true;
        throw err;
      }
    });
    // Keep the chain alive even when an append fails.
    this.chain = next.catch(() => undefined);
    return next;
  }

  /**
   * Best-effort append for audit facts (run/worktree/DLQ events) that must
   * never break the caller. Returns false when the write was dropped.
   */
  async appendSafe(drafts: TaskEventDraft[]): Promise<boolean> {
    try {
      await this.append(drafts);
      return true;
    } catch (err) {
      console.warn("[taskEventStore] audit append dropped:", err);
      return false;
    }
  }

  async readAll(sinceSeq?: number): Promise<TaskEvent[]> {
    return this.ensureAdapter().read(sinceSeq);
  }

  /** In-process fan-out — projections (board, inbox, DLQ) subscribe here. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(events: TaskEvent[]): void {
    for (const listener of this.listeners) {
      try {
        listener(events);
      } catch (err) {
        console.warn("[taskEventStore] listener failed:", err);
      }
    }
  }

  /** Cross-window/process sync: emit appended events over the Tauri bus. */
  private async broadcast(events: TaskEvent[]): Promise<void> {
    if (!isTauri()) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(TASK_EVENTS_BROADCAST, { source: this.windowTag, events });
    } catch {
      // Broadcast is best-effort; the log itself is already durable.
    }
  }

  /** Apply appends that originated in another window of the app. */
  private async listenForExternalAppends(): Promise<void> {
    if (!isTauri() || this.externalUnlisten) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      this.externalUnlisten = await listen<{ source: string; events: TaskEvent[] }>(
        TASK_EVENTS_BROADCAST,
        (message) => {
          if (message.payload?.source === this.windowTag) return;
          if (Array.isArray(message.payload?.events)) {
            this.notify(message.payload.events);
          }
        },
      );
    } catch {
      // Single-window sessions work fine without the bus.
    }
  }
}

export const taskEventStore = new TaskEventStore();
export default taskEventStore;
