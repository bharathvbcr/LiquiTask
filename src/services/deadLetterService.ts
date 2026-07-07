import { STORAGE_KEYS } from "../constants";
import taskEventStore from "../core/events/taskEventStore";
import storageService from "./storageService";

/**
 * Dead-letter queue for failed side effects.
 *
 * Any agent action or git operation that fails after its intent was recorded
 * lands here instead of vanishing into a console.warn: failed merges, failed
 * MCP board mutations, crashed runs, automation errors, and dropped event-log
 * writes. Letters are persisted (survive restarts), surfaced in the Inbox
 * with retry/discard actions, and mirrored into the task event log as
 * `action.dead-lettered` / `action.retried` / `action.discarded` audit facts.
 *
 * Retry is pluggable: the module that knows how to re-execute a kind of
 * action registers a handler (`registerRetryHandler`) at startup — e.g. the
 * merge pipeline re-runs the transactional merge, the MCP service re-applies
 * the board mutation.
 */

export type DeadLetterKind =
  | "merge"
  | "mcp-action"
  | "run"
  | "automation"
  | "event-log";

export type DeadLetterStatus = "open" | "resolved" | "discarded";

export interface DeadLetter {
  id: string;
  kind: DeadLetterKind;
  taskId?: string;
  runId?: string;
  /** One-line summary for Inbox cards. */
  title: string;
  /** Failure detail (grows with each failed retry). */
  detail: string;
  /** Everything a retry handler needs to re-execute the action. */
  payload: Record<string, unknown>;
  createdAt: Date;
  attempts: number;
  lastAttemptAt?: Date;
  status: DeadLetterStatus;
}

export type RetryHandler = (letter: DeadLetter) => Promise<void>;
type Listener = (open: DeadLetter[]) => void;

const MAX_LETTERS = 200;
const MAX_DETAIL_CHARS = 4000;

class DeadLetterService {
  private letters: DeadLetter[] = [];
  private loaded = false;
  private listeners = new Set<Listener>();
  private retryHandlers = new Map<DeadLetterKind, RetryHandler>();

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const raw = storageService.get<DeadLetter[]>(STORAGE_KEYS.DEAD_LETTERS, []);
    this.letters = (raw ?? []).map((l) => ({
      ...l,
      createdAt: new Date(l.createdAt),
      lastAttemptAt: l.lastAttemptAt ? new Date(l.lastAttemptAt) : undefined,
    }));
  }

  /** Register the re-execution strategy for a letter kind (idempotent). */
  registerRetryHandler(kind: DeadLetterKind, handler: RetryHandler): void {
    this.retryHandlers.set(kind, handler);
  }

  /** Record a failed action. Returns the persisted letter. */
  record(input: {
    kind: DeadLetterKind;
    title: string;
    detail: string;
    payload?: Record<string, unknown>;
    taskId?: string;
    runId?: string;
  }): DeadLetter {
    this.ensureLoaded();
    const letter: DeadLetter = {
      id: `dlq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: input.kind,
      taskId: input.taskId,
      runId: input.runId,
      title: input.title.slice(0, 200),
      detail: input.detail.slice(0, MAX_DETAIL_CHARS),
      payload: input.payload ?? {},
      createdAt: new Date(),
      attempts: 0,
      status: "open",
    };
    this.letters = [letter, ...this.letters].slice(0, MAX_LETTERS);
    this.persist();
    this.notify();
    void taskEventStore.appendSafe([
      {
        streamId: input.taskId ?? "board",
        type: "action.dead-lettered",
        payload: {
          deadLetterId: letter.id,
          kind: letter.kind,
          title: letter.title,
          detail: letter.detail.slice(0, 500),
        },
        actor: "system",
        runId: input.runId,
      },
    ]);
    return letter;
  }

  getOpen(): DeadLetter[] {
    this.ensureLoaded();
    return this.letters.filter((l) => l.status === "open");
  }

  getAll(): DeadLetter[] {
    this.ensureLoaded();
    return [...this.letters];
  }

  getById(id: string): DeadLetter | undefined {
    this.ensureLoaded();
    return this.letters.find((l) => l.id === id);
  }

  /**
   * Re-execute a letter through its registered handler. On success the
   * letter resolves; on failure it stays open with the new error recorded.
   */
  async retry(id: string): Promise<{ ok: boolean; error?: string }> {
    this.ensureLoaded();
    const letter = this.letters.find((l) => l.id === id && l.status === "open");
    if (!letter) return { ok: false, error: "Dead letter not found or already closed." };
    const handler = this.retryHandlers.get(letter.kind);
    if (!handler) {
      return { ok: false, error: `No retry handler registered for "${letter.kind}".` };
    }

    letter.attempts += 1;
    letter.lastAttemptAt = new Date();
    try {
      await handler(letter);
      letter.status = "resolved";
      this.persist();
      this.notify();
      void taskEventStore.appendSafe([
        {
          streamId: letter.taskId ?? "board",
          type: "action.retried",
          payload: { deadLetterId: letter.id, kind: letter.kind, ok: true },
          actor: "user",
          runId: letter.runId,
        },
      ]);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      letter.detail = `${letter.detail}\n— retry #${letter.attempts} failed: ${message}`.slice(
        0,
        MAX_DETAIL_CHARS,
      );
      this.persist();
      this.notify();
      void taskEventStore.appendSafe([
        {
          streamId: letter.taskId ?? "board",
          type: "action.retried",
          payload: {
            deadLetterId: letter.id,
            kind: letter.kind,
            ok: false,
            error: message.slice(0, 500),
          },
          actor: "user",
          runId: letter.runId,
        },
      ]);
      return { ok: false, error: message };
    }
  }

  discard(id: string): void {
    this.ensureLoaded();
    const letter = this.letters.find((l) => l.id === id && l.status === "open");
    if (!letter) return;
    letter.status = "discarded";
    this.persist();
    this.notify();
    void taskEventStore.appendSafe([
      {
        streamId: letter.taskId ?? "board",
        type: "action.discarded",
        payload: { deadLetterId: letter.id, kind: letter.kind },
        actor: "user",
        runId: letter.runId,
      },
    ]);
  }

  /** Resolve without retrying (e.g. the user fixed it manually). */
  resolve(id: string): void {
    this.ensureLoaded();
    const letter = this.letters.find((l) => l.id === id && l.status === "open");
    if (!letter) return;
    letter.status = "resolved";
    this.persist();
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.ensureLoaded();
    this.listeners.add(listener);
    listener(this.getOpen());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const open = this.getOpen();
    for (const listener of this.listeners) {
      try {
        listener(open);
      } catch (err) {
        console.warn("[deadLetterService] listener failed:", err);
      }
    }
  }

  private persist(): void {
    void storageService.set(STORAGE_KEYS.DEAD_LETTERS, this.letters);
  }
}

export const deadLetterService = new DeadLetterService();
export default deadLetterService;
