import type { AgentRunEventKind } from "../../../types";

export interface ParsedStreamEvent {
  kind: AgentRunEventKind;
  text: string;
}

export interface ParsedStreamLine {
  events: ParsedStreamEvent[];
  sessionId?: string;
  /** Present only on the final `result` message. */
  result?: {
    summary?: string;
    numTurns?: number;
    costUsd?: number;
    isError: boolean;
  };
}

const describeToolUse = (name: string, input: unknown): string => {
  const i = (input ?? {}) as Record<string, unknown>;
  const target =
    (i.file_path as string) ?? (i.command as string) ?? (i.pattern as string) ?? "";
  return target ? `${name}: ${String(target).slice(0, 200)}` : name;
};

/** Parse one Claude Code `--output-format stream-json` NDJSON line. */
export const parseClaudeStreamLine = (line: string): ParsedStreamLine => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { events: [{ kind: "info", text: line }] };
  }

  const type = parsed.type as string | undefined;

  if (type === "system") {
    return {
      events: [{ kind: "system", text: `Session started (${String(parsed.subtype ?? "init")})` }],
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    };
  }

  if (type === "assistant") {
    const message = parsed.message as { content?: unknown[] } | undefined;
    const events: ParsedStreamEvent[] = [];
    for (const block of message?.content ?? []) {
      const b = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (b.type === "text" && b.text) {
        events.push({ kind: "assistant", text: b.text });
      } else if (b.type === "tool_use" && b.name) {
        events.push({ kind: "tool", text: describeToolUse(b.name, b.input) });
      }
    }
    return { events };
  }

  if (type === "result") {
    const summary = typeof parsed.result === "string" ? parsed.result : undefined;
    const isError = parsed.is_error === true || parsed.subtype !== "success";
    return {
      events: [
        {
          kind: "result",
          text: summary ?? (isError ? `Run ended: ${String(parsed.subtype)}` : "Run completed"),
        },
      ],
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
      result: {
        summary,
        numTurns: typeof parsed.num_turns === "number" ? parsed.num_turns : undefined,
        costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
        isError,
      },
    };
  }

  // Unknown structured line — keep it visible but low-key.
  return { events: [{ kind: "info", text: line.slice(0, 400) }] };
};

export interface CouncilVerdict {
  passed: boolean;
  blockingGaps: string[];
  summary?: string;
  raw: string;
}

/**
 * Parse the JSON report emitted by DevCouncil (`dev e2e --json` /
 * `dev check --verify --json`). Tolerant of leading log noise before the JSON.
 */
export const parseCouncilReport = (raw: string): CouncilVerdict => {
  const bounded = raw.slice(0, 200_000);
  const jsonStart = bounded.indexOf("{");
  const fallback: CouncilVerdict = {
    passed: true,
    blockingGaps: [],
    raw: bounded.slice(0, 4000),
  };
  if (jsonStart < 0) return fallback;

  try {
    const parsed = JSON.parse(bounded.slice(jsonStart)) as {
      ok?: boolean;
      passed?: boolean;
      blocking_gaps?: unknown[];
      next_actions?: unknown[];
      diff_summary?: unknown;
    };
    const gaps = (parsed.blocking_gaps ?? []).map((g) =>
      typeof g === "string" ? g : JSON.stringify(g),
    );
    const passed = (parsed.passed ?? parsed.ok ?? gaps.length === 0) && gaps.length === 0;
    return {
      passed,
      blockingGaps: gaps,
      summary: typeof parsed.diff_summary === "string" ? parsed.diff_summary : undefined,
      raw: bounded.slice(0, 4000),
    };
  } catch {
    return fallback;
  }
};
