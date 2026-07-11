import type { AgentRunEventKind } from "../../../types";
import type { DevVerifyResult } from "../nativeBridge";
import { evaluateVerifyGate } from "./mergePipelineService";

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

/** Parse DevCouncil verify JSON from stdout, tolerating leading log noise. */
export function parseCouncilVerifyResult(raw: string): DevVerifyResult | null {
  const bounded = raw.slice(0, 200_000);
  const jsonStart = bounded.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(bounded.slice(jsonStart)) as DevVerifyResult & {
      blocking_gaps?: unknown[];
      passed?: boolean;
    };
    const legacyGaps = (parsed.blocking_gaps ?? []).map((g) =>
      typeof g === "string" ? g : JSON.stringify(g),
    );
    if (legacyGaps.length > 0 && (!parsed.tasks || parsed.tasks.length === 0)) {
      return {
        ok: parsed.ok === false || parsed.passed === false || legacyGaps.length > 0,
        cli_available: true,
        verified_tasks: 0,
        blocked_tasks: legacyGaps.length,
        total_gaps: legacyGaps.length,
        tasks: legacyGaps.map((description, index) => ({
          task_id: `legacy-${index}`,
          status: "blocked",
          gap_count: 1,
          blocking_gap_count: 1,
          gaps: [
            {
              id: `legacy-gap-${index}`,
              severity: "critical",
              gap_type: "legacy",
              description,
              evidence: [],
              recommended_fix: "",
              blocking: true,
            },
          ],
          next_actions: [],
          advisory_actions: [],
        })),
        error: typeof parsed.error === "string" ? parsed.error : undefined,
      };
    }
    return { ...parsed, cli_available: true };
  } catch {
    return null;
  }
}

/**
 * Parse the JSON report emitted by DevCouncil (`dev e2e --json` /
 * `dev check --verify --json`). Fail closed when output is missing or
 * unparseable; uses the same nested gap schema as the merge-path verify gate.
 */
export const parseCouncilReport = (raw: string): CouncilVerdict => {
  const bounded = raw.slice(0, 200_000);
  const verify = parseCouncilVerifyResult(bounded);
  if (!verify) {
    return {
      passed: false,
      blockingGaps: ["DevCouncil verify output missing or unparseable"],
      raw: bounded.slice(0, 4000),
    };
  }
  const gate = evaluateVerifyGate(verify);
  const summary =
    typeof (verify as { diff_summary?: unknown }).diff_summary === "string"
      ? ((verify as { diff_summary?: string }).diff_summary ?? undefined)
      : verify.error;
  return {
    passed: gate.passed && verify.ok !== false,
    blockingGaps: gate.blockingGaps,
    summary,
    raw: bounded.slice(0, 4000),
  };
};
