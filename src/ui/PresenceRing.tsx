import type React from "react";

export type PresenceStatus = "idle" | "working" | "blocked" | "awaiting-approval";

export interface PresenceRingProps {
  status: PresenceStatus;
  size?: number;
  children?: React.ReactNode;
  className?: string;
}

const STATUS_RING: Record<PresenceStatus, string> = {
  idle: "ring-slate-500/40",
  working: "ring-emerald-400/70",
  blocked: "ring-red-500/70",
  "awaiting-approval": "ring-amber-400/70",
};

const STATUS_DOT: Record<PresenceStatus, string> = {
  idle: "bg-slate-500",
  working: "bg-emerald-400",
  blocked: "bg-red-500",
  "awaiting-approval": "bg-amber-400",
};

/** Avatar-sized ring showing agent presence, with a breathing pulse while working. */
export const PresenceRing: React.FC<PresenceRingProps> = ({
  status,
  size = 36,
  children,
  className = "",
}) => {
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 rounded-full ring-2 ${STATUS_RING[status]} ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="flex items-center justify-center w-full h-full rounded-full bg-slate-900/80 overflow-hidden">
        {children}
      </span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-slate-950 ${STATUS_DOT[status]} ${
          status === "working" ? "animate-pulse" : ""
        }`}
        aria-hidden
      />
      <span className="sr-only">{status}</span>
    </span>
  );
};

export default PresenceRing;
