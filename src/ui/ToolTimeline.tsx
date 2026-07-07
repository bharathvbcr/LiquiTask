import type React from "react";

import type { AgentRunEvent } from "../../types";

export interface ToolTimelineEntry {
  ts: Date;
  /** Tool name — the transcript text before the first "(". */
  name: string;
  /** Serialized call arguments (the "{...json}" between the parens). */
  detail: string;
  /** Result lines ("→ …" events) that followed this call, arrow stripped. */
  outputs: string[];
}

/** Tool events that report output rather than a call are prefixed with "→". */
function isOutputText(text: string): boolean {
  return text.trimStart().startsWith("→");
}

/**
 * Groups a run's tool events into call+result entries. The transcript emits
 * tool activity as two separate events — `toolName({...json})` then `→ output`
 * — so we re-pair them here instead of asking the persistence layer to change
 * its event shape. A leading orphan output (transcript truncated mid-run)
 * still gets its own entry so nothing silently disappears.
 */
export function groupToolEvents(events: AgentRunEvent[]): ToolTimelineEntry[] {
  const entries: ToolTimelineEntry[] = [];
  for (const event of events) {
    if (event.kind !== "tool") continue;

    if (isOutputText(event.text)) {
      const stripped = event.text.trimStart().replace(/^→\s*/, "");
      const last = entries[entries.length - 1];
      if (last) {
        last.outputs.push(stripped);
      } else {
        entries.push({ ts: event.ts, name: "output", detail: stripped, outputs: [] });
      }
      continue;
    }

    const parenIndex = event.text.indexOf("(");
    const name = (parenIndex > 0 ? event.text.slice(0, parenIndex) : event.text).trim();
    const detail =
      parenIndex > 0 ? event.text.slice(parenIndex + 1).replace(/\)\s*$/, "") : "";
    entries.push({ ts: event.ts, name, detail, outputs: [] });
  }
  return entries;
}

function formatTs(ts: Date): string {
  return ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export interface ToolTimelineProps {
  /** Full run event stream; non-tool events are ignored here. */
  events: AgentRunEvent[];
  className?: string;
}

/**
 * Compact vertical timeline of a run's tool activity. The transcript already
 * shows tool events inline, but interleaved with assistant prose they're hard
 * to scan — this view answers "what did the agent actually touch?" at a
 * glance. Renders nothing when the run made no tool calls.
 */
export const ToolTimeline: React.FC<ToolTimelineProps> = ({ events, className = "" }) => {
  const entries = groupToolEvents(events);
  if (entries.length === 0) return null;

  return (
    <ol className={`list-none ${className}`}>
      {entries.map((entry, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: static list recomputed each render, no natural id
          key={`${entry.ts.getTime()}-${index}`}
          className="relative flex gap-2.5 pb-3 last:pb-0"
        >
          {index < entries.length - 1 && (
            <span
              aria-hidden
              className="absolute left-[3.5px] top-3.5 bottom-0 w-px bg-white/10"
            />
          )}
          <span
            aria-hidden
            className="relative mt-1.5 h-2 w-2 rounded-full bg-red-500/60 border border-red-400/40 shrink-0"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-slate-200 truncate">
                {entry.name}
              </span>
              <span className="text-[10px] text-slate-600 font-mono shrink-0">
                {formatTs(entry.ts)}
              </span>
            </div>
            {entry.detail && (
              <div className="font-mono text-[10px] text-slate-500 truncate">{entry.detail}</div>
            )}
            {entry.outputs.map((output, outputIndex) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: static list recomputed each render, no natural id
                key={`${entry.ts.getTime()}-out-${outputIndex}`}
                className="font-mono text-[10px] text-emerald-300/70 truncate"
              >
                {`→ ${output}`}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
};

export default ToolTimeline;
