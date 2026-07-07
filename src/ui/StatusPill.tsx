import type React from "react";

export type StatusTone = "amber" | "red" | "emerald" | "slate" | "blue" | "purple";

export interface StatusPillProps {
  status: string;
  tone?: StatusTone;
  className?: string;
}

const STATUS_TONE: Record<string, StatusTone> = {
  running: "amber",
  "in-progress": "amber",
  verifying: "blue",
  queued: "slate",
  pending: "slate",
  paused: "blue",
  completed: "emerald",
  verified: "emerald",
  done: "emerald",
  failed: "red",
  error: "red",
  cancelled: "slate",
  blocked: "red",
  "awaiting-approval": "purple",
  review: "amber",
};

const TONE_CLASSES: Record<StatusTone, string> = {
  amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  red: "bg-red-500/10 text-red-300 border-red-500/20",
  emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  slate: "bg-slate-500/10 text-slate-300 border-slate-500/20",
  blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
};

/** Small rounded status badge with a sensible color mapping (running/failed/completed/etc). */
export const StatusPill: React.FC<StatusPillProps> = ({ status, tone, className = "" }) => {
  const resolvedTone = tone ?? STATUS_TONE[status.toLowerCase()] ?? "slate";
  const isPulsing = resolvedTone === "amber";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-normal ${TONE_CLASSES[resolvedTone]} ${className}`}
    >
      {isPulsing && (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" aria-hidden />
      )}
      {status}
    </span>
  );
};

export default StatusPill;
